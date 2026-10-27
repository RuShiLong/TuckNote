using System.Security.Claims;
using System.Data;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Tucknote.Data;

namespace Tucknote.Features;

public static class AuthEndpoints
{
    public static Guid UserId(this ClaimsPrincipal user) => Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);

    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapGet("/api/auth/setup-status", async (AppDbContext db) => Results.Ok(new { needed = !await db.Users.AnyAsync() }));
        app.MapPost("/api/auth/setup", async (SetupRequest input, AppDbContext db, IPasswordHasher<AppUser> hasher, IConfiguration config, HttpContext http) =>
        {
            var expected = config["BootstrapToken"];
            if (string.IsNullOrWhiteSpace(expected) || !SecureEquals(expected, input.Token)) return Results.BadRequest(new { error = "Mã thiết lập không hợp lệ." });
            if (!ValidPassword(input.Password) || !ValidEmail(input.Email)) return Results.BadRequest(new { error = "Email hoặc mật khẩu không hợp lệ (tối thiểu 12 ký tự)." });
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            if (await db.Users.AnyAsync()) return Results.Conflict(new { error = "Tài khoản chủ sở hữu đã tồn tại." });
            var user = new AppUser { Email = input.Email!.Trim().ToLowerInvariant() };
            user.PasswordHash = hasher.HashPassword(user, input.Password!);
            db.Users.Add(user);
            try { await db.SaveChangesAsync(); await transaction.CommitAsync(); }
            catch (DbUpdateException) { return Results.Conflict(new { error = "Thiết lập đã hoàn tất ở thiết bị khác." }); }
            await SignIn(http, db, user);
            return Results.Ok(new { email = user.Email });
        }).RequireRateLimiting("sensitive");

        app.MapPost("/api/auth/login", async (LoginRequest input, AppDbContext db, IPasswordHasher<AppUser> hasher, HttpContext http) =>
        {
            if (string.IsNullOrWhiteSpace(input.Email) || input.Password is null)
                return Results.Json(new { error = "Email hoặc mật khẩu không đúng." }, statusCode: 401);
            var user = await db.Users.SingleOrDefaultAsync(x => x.Email == input.Email.Trim().ToLowerInvariant());
            if (user is null || hasher.VerifyHashedPassword(user, user.PasswordHash, input.Password) == PasswordVerificationResult.Failed)
                return Results.Json(new { error = "Email hoặc mật khẩu không đúng." }, statusCode: 401);
            await SignIn(http, db, user);
            return Results.Ok(new { email = user.Email });
        }).RequireRateLimiting("sensitive");

        var auth = app.MapGroup("/api/auth").RequireAuthorization();
        auth.MapGet("/me", async (ClaimsPrincipal principal, AppDbContext db) =>
        {
            var user = await db.Users.FindAsync(principal.UserId());
            return Results.Ok(new { user?.Email });
        });
        auth.MapPost("/logout", async (ClaimsPrincipal principal, AppDbContext db, HttpContext http) =>
        {
            var sid = Guid.Parse(principal.FindFirstValue("sid")!);
            var session = await db.Sessions.FindAsync(sid);
            if (session is not null) { session.RevokedAt = DateTimeOffset.UtcNow; await db.SaveChangesAsync(); }
            await http.SignOutAsync();
            return Results.Ok();
        });
        auth.MapPost("/password", async (ChangePasswordRequest input, ClaimsPrincipal principal, AppDbContext db, IPasswordHasher<AppUser> hasher, HttpContext http) =>
        {
            var user = await db.Users.FindAsync(principal.UserId());
            if (user is null || input.Current is null || hasher.VerifyHashedPassword(user, user.PasswordHash, input.Current) == PasswordVerificationResult.Failed)
                return Results.BadRequest(new { error = "Mật khẩu hiện tại không đúng." });
            if (!ValidPassword(input.NewPassword)) return Results.BadRequest(new { error = "Mật khẩu mới cần ít nhất 12 ký tự." });
            user.PasswordHash = hasher.HashPassword(user, input.NewPassword!);
            user.SecurityStamp = Guid.NewGuid().ToString("N");
            await db.Sessions.Where(x => x.UserId == user.Id).ExecuteUpdateAsync(x => x.SetProperty(s => s.RevokedAt, DateTimeOffset.UtcNow));
            await db.SaveChangesAsync();
            await http.SignOutAsync();
            return Results.Ok();
        }).RequireRateLimiting("sensitive");
        auth.MapGet("/sessions", async (ClaimsPrincipal principal, AppDbContext db) =>
            Results.Ok(await db.Sessions.Where(x => x.UserId == principal.UserId() && x.RevokedAt == null)
                .Select(x => new { x.Id, x.Device, x.CreatedAt, x.LastSeenAt }).ToListAsync()));
        auth.MapDelete("/sessions/{id:guid}", async (Guid id, ClaimsPrincipal principal, AppDbContext db) =>
        {
            var session = await db.Sessions.SingleOrDefaultAsync(x => x.Id == id && x.UserId == principal.UserId());
            if (session is null) return Results.NotFound();
            session.RevokedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok();
        });
    }

    private static async Task SignIn(HttpContext http, AppDbContext db, AppUser user)
    {
        var agent = http.Request.Headers.UserAgent.ToString();
        var session = new LoginSession { UserId = user.Id, Device = agent[..Math.Min(agent.Length, 200)] };
        db.Sessions.Add(session);
        await db.SaveChangesAsync();
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()), new Claim("sid", session.Id.ToString()), new Claim("stamp", user.SecurityStamp) };
        await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));
    }

    private static bool ValidEmail(string? value) => value is not null && value.Length <= 320 && value.Contains('@') && value.Contains('.');
    private static bool ValidPassword(string? value) => value is not null && value.Length >= 12 && value.Length <= 256;
    private static bool SecureEquals(string a, string? b)
    {
        if (b is null) return false;
        var first = SHA256.HashData(Encoding.UTF8.GetBytes(a));
        var second = SHA256.HashData(Encoding.UTF8.GetBytes(b));
        return CryptographicOperations.FixedTimeEquals(first, second);
    }
    public sealed record SetupRequest(string Email, string Password, string Token);
    public sealed record LoginRequest(string Email, string Password);
    public sealed record ChangePasswordRequest(string Current, string NewPassword);
}
