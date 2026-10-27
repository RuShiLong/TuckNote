using System.Security.Claims;
using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using Tucknote.Data;
using Tucknote.Features;

var builder = WebApplication.CreateBuilder(args);
var connection = builder.Configuration.GetConnectionString("TuckNote");
if (string.IsNullOrWhiteSpace(connection))
    throw new InvalidOperationException("Set ConnectionStrings__TuckNote using a secret store or environment variable.");
if (!builder.Environment.IsDevelopment())
{
    var sql = new SqlConnectionStringBuilder(connection);
    if (sql.Encrypt == SqlConnectionEncryptOption.Optional || sql.TrustServerCertificate || sql.IntegratedSecurity ||
        string.IsNullOrWhiteSpace(sql.UserID) || sql.InitialCatalog != "TuckNote")
        throw new InvalidOperationException("Production SQL must use SQL Authentication, database TuckNote, encryption and a trusted server certificate.");
    var keysPath = builder.Configuration["DataProtection:KeysPath"];
    if (string.IsNullOrWhiteSpace(keysPath)) throw new InvalidOperationException("Set DataProtection__KeysPath to a persistent protected directory.");
    if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Production key protection is configured for Windows on NSHLONG.");
    builder.Services.AddDataProtection().SetApplicationName("TuckNote")
        .PersistKeysToFileSystem(new DirectoryInfo(keysPath)).ProtectKeysWithDpapi();
}

builder.Services.AddDbContext<AppDbContext>(o => o.UseSqlServer(connection));
builder.Services.AddScoped<IPasswordHasher<AppUser>, PasswordHasher<AppUser>>();
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.Cookie.Name = "__Host-TuckNote";
    o.Cookie.HttpOnly = true;
    o.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.Path = "/";
    o.ExpireTimeSpan = TimeSpan.FromMinutes(30);
    o.SlidingExpiration = true;
    o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; };
    o.Events.OnValidatePrincipal = async c =>
    {
        var id = c.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        var sid = c.Principal?.FindFirstValue("sid");
        if (!Guid.TryParse(id, out var userId) || !Guid.TryParse(sid, out var sessionId)) { c.RejectPrincipal(); return; }
        var db = c.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
        var session = await db.Sessions.FindAsync(sessionId);
        var user = await db.Users.FindAsync(userId);
        if (session is null || user is null || session.UserId != userId || session.RevokedAt is not null ||
            session.LastSeenAt < DateTimeOffset.UtcNow.AddMinutes(-30) ||
            user.SecurityStamp != c.Principal?.FindFirstValue("stamp"))
        {
            c.RejectPrincipal();
            await c.HttpContext.SignOutAsync();
            return;
        }
        if (session.LastSeenAt < DateTimeOffset.UtcNow.AddMinutes(-1))
        {
            session.LastSeenAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
        }
    };
});
builder.Services.AddAuthorization();
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownProxies.Add(IPAddress.Loopback);
    o.KnownProxies.Add(IPAddress.IPv6Loopback);
});
builder.Services.AddAntiforgery(o =>
{
    o.HeaderName = "X-CSRF-TOKEN";
    o.Cookie.Name = "__Host-TuckNote-CSRF";
    o.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.Path = "/";
});
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy("sensitive", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 12, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});

var app = builder.Build();
app.UseForwardedHeaders();
app.UseHttpsRedirection();
app.UseHsts();
app.Use(async (context, next) =>
{
    context.Response.Headers.ContentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers.CacheControl = context.Request.Path.StartsWithSegments("/api") ? "no-store" : "no-cache";
    await next();
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.MapGet("/api/csrf", (HttpContext http, IAntiforgery antiforgery) =>
    Results.Ok(new { token = antiforgery.GetAndStoreTokens(http).RequestToken }));
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api") &&
        !HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
    {
        try { await context.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(context); }
        catch (AntiforgeryValidationException) { context.Response.StatusCode = 400; return; }
    }
    await next();
});
app.MapAuthEndpoints();
app.MapItemEndpoints();
app.MapVaultEndpoints();
app.MapBackupEndpoints();
app.Map("/api/{**path}", () => Results.NotFound());
app.MapFallbackToFile("index.html");
app.Run();

public partial class Program;
