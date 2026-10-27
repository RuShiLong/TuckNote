using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Tucknote.Data;

namespace Tucknote.Features;

public static class VaultEndpoints
{
    public static void MapVaultEndpoints(this WebApplication app)
    {
        var vault = app.MapGroup("/api/vault").RequireAuthorization();
        vault.MapGet("/profile", async (ClaimsPrincipal user, AppDbContext db) =>
            Results.Ok(await db.VaultProfiles.AsNoTracking().SingleOrDefaultAsync(x => x.UserId == user.UserId()))).RequireRateLimiting("sensitive");
        vault.MapPost("/profile", async (VaultProfileInput input, ClaimsPrincipal user, AppDbContext db) =>
        {
            if (await db.VaultProfiles.AnyAsync(x => x.UserId == user.UserId())) return Results.Conflict(new { error = "Két đã được thiết lập." });
            if (input.Iterations is < 600_000 or > 2_000_000 || !ValidBase64(input.Salt, 16, 32) || !ValidBase64(input.MasterIv, 12, 12) ||
                !ValidBase64(input.RecoveryIv, 12, 12) || !ValidBase64(input.WrappedKey, 48, 80) || !ValidBase64(input.RecoveryWrappedKey, 48, 80))
                return Results.BadRequest(new { error = "Thông số mã hóa không hợp lệ." });
            db.VaultProfiles.Add(new VaultProfile { UserId = user.UserId(), Salt = input.Salt, Iterations = input.Iterations, MasterIv = input.MasterIv, WrappedKey = input.WrappedKey, RecoveryIv = input.RecoveryIv, RecoveryWrappedKey = input.RecoveryWrappedKey });
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateException) { return Results.Conflict(new { error = "Két đã được thiết lập." }); }
            return Results.Ok();
        }).RequireRateLimiting("sensitive");
        vault.MapGet("/entries", async (ClaimsPrincipal user, AppDbContext db) =>
            Results.Ok(await db.VaultEntries.AsNoTracking().Where(x => x.UserId == user.UserId() && x.DeletedAt == null).OrderByDescending(x => x.UpdatedAt).ToListAsync()));
        vault.MapGet("/trash", async (ClaimsPrincipal user, AppDbContext db) =>
            Results.Ok(await db.VaultEntries.AsNoTracking().Where(x => x.UserId == user.UserId() && x.DeletedAt != null).OrderByDescending(x => x.DeletedAt).ToListAsync()));
        vault.MapPost("/entries", async (VaultEntryInput input, ClaimsPrincipal user, AppDbContext db) =>
        {
            if (!await db.VaultProfiles.AnyAsync(x => x.UserId == user.UserId())) return Results.BadRequest(new { error = "Hãy thiết lập két trước." });
            if (!ValidEntry(input)) return Results.BadRequest(new { error = "Dữ liệu mã hóa không hợp lệ." });
            var entry = new VaultEntry { UserId = user.UserId(), Ciphertext = input.Ciphertext, Iv = input.Iv };
            db.VaultEntries.Add(entry);
            await db.SaveChangesAsync();
            return Results.Ok(entry);
        });
        vault.MapPut("/entries/{id:guid}", async (Guid id, VaultEntryInput input, ClaimsPrincipal user, AppDbContext db) =>
        {
            if (!ValidEntry(input)) return Results.BadRequest(new { error = "Dữ liệu mã hóa không hợp lệ." });
            var entry = await db.VaultEntries.SingleOrDefaultAsync(x => x.Id == id && x.UserId == user.UserId() && x.DeletedAt == null);
            if (entry is null) return Results.NotFound();
            if (entry.Revision != input.Revision) return Results.Conflict(new { error = "Mục đã được sửa ở thiết bị khác.", current = entry });
            entry.Ciphertext = input.Ciphertext; entry.Iv = input.Iv; entry.Revision++; entry.UpdatedAt = DateTimeOffset.UtcNow;
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateConcurrencyException) { return Results.Conflict(new { error = "Mục đã được sửa ở thiết bị khác." }); }
            return Results.Ok(entry);
        });
        vault.MapDelete("/entries/{id:guid}", async (Guid id, int revision, ClaimsPrincipal user, AppDbContext db) =>
        {
            var entry = await db.VaultEntries.SingleOrDefaultAsync(x => x.Id == id && x.UserId == user.UserId() && x.DeletedAt == null);
            if (entry is null) return Results.NotFound();
            if (entry.Revision != revision) return Results.Conflict(new { error = "Mục đã được sửa ở thiết bị khác." });
            entry.DeletedAt = DateTimeOffset.UtcNow; entry.Revision++;
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateConcurrencyException) { return Results.Conflict(new { error = "Mục đã được sửa ở thiết bị khác." }); }
            return Results.Ok();
        });
        vault.MapPost("/entries/{id:guid}/restore", async (Guid id, RestoreInput input, ClaimsPrincipal user, AppDbContext db) =>
        {
            var entry = await db.VaultEntries.SingleOrDefaultAsync(x => x.Id == id && x.UserId == user.UserId() && x.DeletedAt != null);
            if (entry is null) return Results.NotFound();
            if (entry.Revision != input.Revision) return Results.Conflict(new { error = "Mục đã được sửa ở thiết bị khác." });
            entry.DeletedAt = null; entry.Revision++; entry.UpdatedAt = DateTimeOffset.UtcNow;
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateConcurrencyException) { return Results.Conflict(new { error = "Mục đã được sửa ở thiết bị khác." }); }
            return Results.Ok();
        });
    }
    private static bool ValidEntry(VaultEntryInput x) => ValidBase64(x.Iv, 12, 12) && ValidBase64(x.Ciphertext, 17, 200_000);
    internal static bool ValidBase64(string? value, int min, int max)
    {
        if (value is null) return false;
        if (value.Length > max * 2) return false;
        try { var bytes = Convert.FromBase64String(value); return bytes.Length >= min && bytes.Length <= max; }
        catch (FormatException) { return false; }
    }
    public sealed record VaultProfileInput(string Salt, int Iterations, string WrappedKey, string MasterIv, string RecoveryWrappedKey, string RecoveryIv);
    public sealed record VaultEntryInput(string Ciphertext, string Iv, int Revision);
    public sealed record RestoreInput(int Revision);
}
