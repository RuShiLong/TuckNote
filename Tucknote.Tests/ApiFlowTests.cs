using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.DependencyInjection;
using Tucknote.Data;

namespace Tucknote.Tests;

public sealed class ApiFlowTests : IAsyncLifetime
{
    private readonly string _connection = $"Server=(localdb)\\MSSQLLocalDB;Database=TuckNoteTest_{Guid.NewGuid():N};Trusted_Connection=True;Encrypt=True;TrustServerCertificate=True";
    private readonly WebApplicationFactory<Program> _factory;
    private const string Password = "test-strong-passphrase-123";

    public ApiFlowTests()
    {
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(host =>
        {
            host.UseEnvironment("Development");
            host.UseSetting("ConnectionStrings:TuckNote", _connection);
            host.UseSetting("BootstrapToken", "test-bootstrap-only");
        });
    }

    public async Task InitializeAsync()
    {
        await using var db = Database();
        await db.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        _factory.Dispose();
        await using var db = Database();
        await db.Database.EnsureDeletedAsync();
    }

    private AppDbContext Database() => new(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(_connection).Options);
    private HttpClient Client() => _factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), HandleCookies = true });
    private static async Task Prepare(HttpClient client)
    {
        var csrf = await client.GetFromJsonAsync<Csrf>("/api/csrf");
        client.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", csrf!.Token);
    }
    private static async Task<HttpResponseMessage> Post(HttpClient client, string path, object data) => await client.PostAsJsonAsync(path, data);

    [Fact]
    public async Task Login_Items_Conflict_Search_Versions_Backup_And_Ownership()
    {
        using var first = Client();
        using (var scope = _factory.Services.CreateScope())
            Assert.Equal(new SqlConnectionStringBuilder(_connection).InitialCatalog, scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.GetDbConnection().Database);
        await Prepare(first);
        Assert.True((await first.GetFromJsonAsync<SetupStatus>("/api/auth/setup-status"))!.Needed);
        Assert.Equal(HttpStatusCode.OK, (await Post(first, "/api/auth/setup", new { email = "owner@example.test", password = Password, token = "test-bootstrap-only" })).StatusCode);
        await Prepare(first);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(first, "/api/auth/setup", new { email = "other@example.test", password = Password, token = "test-bootstrap-only" })).StatusCode);
        var created = await (await Post(first, "/api/items", Input("note", "Alpha", "first body", 1))).Content.ReadFromJsonAsync<ItemResult>();
        Assert.NotNull(created);
        Assert.Equal(1, created.Revision);
        Assert.Single((await first.GetFromJsonAsync<List<ItemResult>>("/api/items?kind=note&q=Alpha"))!);
        Assert.Empty((await first.GetFromJsonAsync<List<ItemResult>>("/api/items?kind=note&q=missing"))!);

        var changedResponse = await first.PutAsJsonAsync($"/api/items/{created.Id}", Input("note", "Alpha", "second body", 1));
        Assert.Equal(HttpStatusCode.OK, changedResponse.StatusCode);
        var changed = await changedResponse.Content.ReadFromJsonAsync<ItemResult>();
        Assert.Equal(2, changed!.Revision);
        Assert.Equal(HttpStatusCode.Conflict, (await first.PutAsJsonAsync($"/api/items/{created.Id}", Input("note", "Alpha", "stale body", 1))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Post(first, $"/api/items/{created.Id}/versions/1/restore", new { revision = 2 })).StatusCode);
        var restored = await first.GetFromJsonAsync<ItemResult>($"/api/items/{created.Id}");
        Assert.Equal("first body", restored!.Body);
        Assert.Equal(3, restored.Revision);
        Assert.Equal(HttpStatusCode.OK, (await Post(first, $"/api/items/{created.Id}/state", new { action = "delete", revision = 3 })).StatusCode);
        Assert.Single((await first.GetFromJsonAsync<List<ItemResult>>("/api/items?status=trash"))!);
        Assert.Equal(HttpStatusCode.OK, (await Post(first, $"/api/items/{created.Id}/state", new { action = "restore", revision = 4 })).StatusCode);

        var profile = new { salt = Convert.ToBase64String(new byte[16]), iterations = 600000,
            wrappedKey = Convert.ToBase64String(new byte[48]), masterIv = Convert.ToBase64String(new byte[12]),
            recoveryWrappedKey = Convert.ToBase64String(new byte[48]), recoveryIv = Convert.ToBase64String(new byte[12]) };
        Assert.Equal(HttpStatusCode.OK, (await Post(first, "/api/vault/profile", profile)).StatusCode);
        var vaultResponse = await Post(first, "/api/vault/entries", new { ciphertext = Convert.ToBase64String(new byte[32]), iv = Convert.ToBase64String(new byte[12]), revision = 1 });
        Assert.Equal(HttpStatusCode.OK, vaultResponse.StatusCode);
        var vault = await vaultResponse.Content.ReadFromJsonAsync<VaultResult>();
        Assert.Equal(HttpStatusCode.OK, (await first.DeleteAsync($"/api/vault/entries/{vault!.Id}?revision=1")).StatusCode);
        Assert.Single((await first.GetFromJsonAsync<List<VaultResult>>("/api/vault/trash"))!);
        Assert.Equal(HttpStatusCode.OK, (await Post(first, $"/api/vault/entries/{vault.Id}/restore", new { revision = 2 })).StatusCode);

        var snapshot = await first.GetFromJsonAsync<BackupSnapshot>("/api/backup/snapshot");
        Assert.Single(snapshot!.Items);
        Assert.Equal(3, snapshot.Versions.Count);
        Assert.Single(snapshot.VaultEntries);
        Assert.Equal(HttpStatusCode.OK, (await Post(first, "/api/backup/restore", snapshot)).StatusCode);
        Assert.Equal(2, (await first.GetFromJsonAsync<List<VaultResult>>("/api/vault/entries"))!.Count);
        Assert.Single((await first.GetFromJsonAsync<List<ItemResult>>("/api/items?skip=1"))!);
        await using (var db = Database())
        {
            var user = new AppUser { Email = "second@example.test" };
            user.PasswordHash = new PasswordHasher<AppUser>().HashPassword(user, Password);
            db.Users.Add(user);
            await db.SaveChangesAsync();
        }
        using var second = Client();
        await Prepare(second);
        Assert.Equal(HttpStatusCode.OK, (await Post(second, "/api/auth/login", new { email = "second@example.test", password = Password })).StatusCode);
        await Prepare(second);
        Assert.Empty((await second.GetFromJsonAsync<List<ItemResult>>("/api/items"))!);
        Assert.Equal(HttpStatusCode.NotFound, (await second.GetAsync($"/api/items/{created.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Post(second, "/api/backup/restore", snapshot)).StatusCode);
        Assert.Single((await second.GetFromJsonAsync<List<ItemResult>>("/api/items?kind=note"))!);
        Assert.Single((await second.GetFromJsonAsync<List<VaultResult>>("/api/vault/entries"))!);
        Assert.Equal(HttpStatusCode.OK, (await Post(first, "/api/auth/logout", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await first.GetAsync("/api/items")).StatusCode);
        using var noCsrf = Client();
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(noCsrf, "/api/auth/login", new { email = "owner@example.test", password = Password })).StatusCode);
        await Prepare(first);
        Assert.Equal(HttpStatusCode.OK, (await Post(first, "/api/auth/login", new { email = "owner@example.test", password = Password })).StatusCode);
        await Prepare(first);
        Assert.Equal(HttpStatusCode.OK, (await Post(first, "/api/auth/password", new { current = Password, newPassword = "another-strong-passphrase-456" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await first.GetAsync("/api/items")).StatusCode);
        await Prepare(first);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(first, "/api/auth/login", new { email = "owner@example.test", password = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Post(first, "/api/auth/login", new { email = "owner@example.test", password = "another-strong-passphrase-456" })).StatusCode);
    }

    private static object Input(string kind, string title, string body, int revision) => new { kind, title, body, url = (string?)null, tags = "", group = "", isPinned = false, revision };
    private sealed record Csrf(string Token);
    private sealed record SetupStatus(bool Needed);
    private sealed record ItemResult(Guid Id, string Kind, string Title, string Body, int Revision);
    private sealed record VaultResult(Guid Id, int Revision);
    private sealed record BackupSnapshot(int Format, List<ItemResult> Items, List<object> Versions, object? VaultProfile, List<object> VaultEntries);
}
