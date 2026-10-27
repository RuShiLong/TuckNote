using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Tucknote.Data;

namespace Tucknote.Features;

public static class BackupEndpoints
{
    public static void MapBackupEndpoints(this WebApplication app)
    {
        var backup = app.MapGroup("/api/backup").RequireAuthorization();
        backup.MapGet("/snapshot", async (ClaimsPrincipal user, AppDbContext db) =>
        {
            var id = user.UserId();
            return Results.Ok(new BackupSnapshot(1,
                await db.Items.AsNoTracking().Where(x => x.UserId == id).ToListAsync(),
                await db.Versions.AsNoTracking().Where(x => x.UserId == id).ToListAsync(),
                await db.VaultProfiles.AsNoTracking().SingleOrDefaultAsync(x => x.UserId == id),
                await db.VaultEntries.AsNoTracking().Where(x => x.UserId == id).ToListAsync()));
        });
        backup.MapPost("/restore", async (BackupSnapshot input, ClaimsPrincipal user, AppDbContext db) =>
        {
            if (input.Format != 1 || input.Items is null || input.Versions is null || input.VaultEntries is null ||
                input.Items.Count > 50_000 || input.Versions.Count > 100_000 || input.VaultEntries.Count > 50_000)
                return Results.BadRequest(new { error = "Định dạng sao lưu không hợp lệ hoặc quá lớn." });
            if (input.Items.Any(x => x.Kind is not ("inbox" or "note" or "link") || x.Title is null || x.Title.Length > 300 ||
                x.Body is null || x.Body.Length > 100_000 || x.Tags is null || x.Tags.Length > 1000 || x.Group is null || x.Group.Length > 120 ||
                (x.Url is not null && x.Url.Length > 2048) ||
                (x.Kind == "link" && (!Uri.TryCreate(x.Url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")))) ||
                input.Versions.Any(x => x.Number < 1 || x.Title is null || x.Title.Length > 300 || x.Body is null || x.Tags is null || x.Tags.Length > 1000 || x.Group is null || x.Group.Length > 120 || x.Body.Length > 100_000) ||
                (input.VaultProfile is null && input.VaultEntries.Count > 0) ||
                (input.VaultProfile is not null && (input.VaultProfile.Iterations is < 600_000 or > 2_000_000 ||
                    !VaultEndpoints.ValidBase64(input.VaultProfile.Salt, 16, 32) ||
                    !VaultEndpoints.ValidBase64(input.VaultProfile.MasterIv, 12, 12) ||
                    !VaultEndpoints.ValidBase64(input.VaultProfile.RecoveryIv, 12, 12) ||
                    !VaultEndpoints.ValidBase64(input.VaultProfile.WrappedKey, 48, 80) ||
                    !VaultEndpoints.ValidBase64(input.VaultProfile.RecoveryWrappedKey, 48, 80))) ||
                input.VaultEntries.Any(x => !VaultEndpoints.ValidBase64(x.Iv, 12, 12) || !VaultEndpoints.ValidBase64(x.Ciphertext, 17, 200_000)))
                return Results.BadRequest(new { error = "Nội dung sao lưu không hợp lệ." });
            var id = user.UserId();
            var existingVault = await db.VaultProfiles.AsNoTracking().SingleOrDefaultAsync(x => x.UserId == id);
            if (input.VaultProfile is not null && existingVault is not null &&
                (existingVault.Salt != input.VaultProfile.Salt || existingVault.Iterations != input.VaultProfile.Iterations ||
                 existingVault.WrappedKey != input.VaultProfile.WrappedKey || existingVault.MasterIv != input.VaultProfile.MasterIv ||
                 existingVault.RecoveryWrappedKey != input.VaultProfile.RecoveryWrappedKey || existingVault.RecoveryIv != input.VaultProfile.RecoveryIv))
                return Results.Conflict(new { error = "Két hiện có dùng khóa khác. Không thể trộn hai két." });
            await using var transaction = await db.Database.BeginTransactionAsync();
            var map = new Dictionary<Guid, Guid>();
            foreach (var old in input.Items)
            {
                var newId = Guid.NewGuid(); map[old.Id] = newId;
                db.Items.Add(new SavedItem { Id = newId, UserId = id, Kind = old.Kind, Title = old.Title, Body = old.Body, Url = old.Url,
                    Tags = old.Tags, Group = old.Group, IsPinned = old.IsPinned, ArchivedAt = old.ArchivedAt, DeletedAt = old.DeletedAt,
                    CreatedAt = old.CreatedAt, UpdatedAt = old.UpdatedAt, Revision = old.Revision });
            }
            foreach (var old in input.Versions)
                if (map.TryGetValue(old.ItemId, out var newId))
                    db.Versions.Add(new ItemVersion { UserId = id, ItemId = newId, Number = old.Number, Title = old.Title,
                        Body = old.Body, Url = old.Url, Tags = old.Tags, Group = old.Group, CreatedAt = old.CreatedAt });
            if (input.VaultProfile is not null)
            {
                var x = input.VaultProfile;
                if (existingVault is null)
                    db.VaultProfiles.Add(new VaultProfile { UserId = id, Salt = x.Salt, Iterations = x.Iterations, WrappedKey = x.WrappedKey,
                        MasterIv = x.MasterIv, RecoveryWrappedKey = x.RecoveryWrappedKey, RecoveryIv = x.RecoveryIv });
                foreach (var old in input.VaultEntries)
                    db.VaultEntries.Add(new VaultEntry { UserId = id, Ciphertext = old.Ciphertext, Iv = old.Iv,
                        Revision = old.Revision, UpdatedAt = old.UpdatedAt, DeletedAt = old.DeletedAt });
            }
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Results.Ok(new { imported = map.Count });
        });
    }
    public sealed record BackupSnapshot(int Format, List<SavedItem> Items, List<ItemVersion> Versions, VaultProfile? VaultProfile, List<VaultEntry> VaultEntries);
}
