using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Tucknote.Data;

namespace Tucknote.Features;

public static class ItemEndpoints
{
    private static readonly string[] Kinds = ["inbox", "note", "link"];

    public static void MapItemEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/items").RequireAuthorization();
        group.MapGet("/", async (ClaimsPrincipal user, AppDbContext db, string? kind, string? status, string? q, string? tag, string? groupName, DateTimeOffset? after, DateTimeOffset? before, int? skip) =>
        {
            var query = db.Items.AsNoTracking().Where(x => x.UserId == user.UserId());
            query = status switch
            {
                "trash" => query.Where(x => x.DeletedAt != null),
                "archive" => query.Where(x => x.DeletedAt == null && x.ArchivedAt != null),
                _ => query.Where(x => x.DeletedAt == null && x.ArchivedAt == null)
            };
            if (Kinds.Contains(kind)) query = query.Where(x => x.Kind == kind);
            if (!string.IsNullOrWhiteSpace(q)) { var term = q.Trim(); query = query.Where(x => x.Title.Contains(term) || x.Body.Contains(term) || (x.Url != null && x.Url.Contains(term))); }
            if (!string.IsNullOrWhiteSpace(tag)) query = query.Where(x => ("," + x.Tags + ",").Contains("," + tag.Trim() + ","));
            if (!string.IsNullOrWhiteSpace(groupName)) query = query.Where(x => x.Group == groupName);
            if (after is not null) query = query.Where(x => x.UpdatedAt >= after);
            if (before is not null) query = query.Where(x => x.UpdatedAt <= before);
            return Results.Ok(await query.OrderByDescending(x => x.IsPinned).ThenByDescending(x => x.UpdatedAt)
                .ThenBy(x => x.Id).Skip(Math.Clamp(skip ?? 0, 0, 1_000_000)).Take(100).ToListAsync());
        });
        group.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var item = await db.Items.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.UserId == user.UserId());
            return item is null ? Results.NotFound() : Results.Ok(item);
        });
        group.MapPost("/", async (ItemInput input, ClaimsPrincipal user, AppDbContext db) =>
        {
            var error = Validate(input);
            if (error is not null) return Results.BadRequest(new { error });
            var item = new SavedItem { UserId = user.UserId() };
            Apply(item, input);
            db.Items.Add(item);
            db.Versions.Add(Snapshot(item));
            await db.SaveChangesAsync();
            return Results.Ok(item);
        });
        group.MapPut("/{id:guid}", async (Guid id, ItemInput input, ClaimsPrincipal user, AppDbContext db) =>
        {
            var error = Validate(input);
            if (error is not null) return Results.BadRequest(new { error });
            var item = await db.Items.SingleOrDefaultAsync(x => x.Id == id && x.UserId == user.UserId());
            if (item is null) return Results.NotFound();
            if (item.Revision != input.Revision) return Results.Conflict(new { error = "Mục đã thay đổi trên thiết bị khác.", current = item });
            Apply(item, input);
            item.Revision++;
            item.UpdatedAt = DateTimeOffset.UtcNow;
            db.Versions.Add(Snapshot(item));
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateConcurrencyException) { return Results.Conflict(new { error = "Mục đã thay đổi trên thiết bị khác." }); }
            return Results.Ok(item);
        });
        group.MapGet("/{id:guid}/versions", async (Guid id, ClaimsPrincipal user, AppDbContext db) =>
        {
            if (!await db.Items.AnyAsync(x => x.Id == id && x.UserId == user.UserId())) return Results.NotFound();
            return Results.Ok(await db.Versions.Where(x => x.ItemId == id && x.UserId == user.UserId()).OrderByDescending(x => x.Number).ToListAsync());
        });
        group.MapPost("/{id:guid}/versions/{number:int}/restore", async (Guid id, int number, RestoreInput input, ClaimsPrincipal user, AppDbContext db) =>
        {
            var item = await db.Items.SingleOrDefaultAsync(x => x.Id == id && x.UserId == user.UserId());
            var version = await db.Versions.SingleOrDefaultAsync(x => x.ItemId == id && x.UserId == user.UserId() && x.Number == number);
            if (item is null || version is null) return Results.NotFound();
            if (item.Revision != input.Revision) return Results.Conflict(new { error = "Mục đã thay đổi trên thiết bị khác.", current = item });
            item.Title = version.Title; item.Body = version.Body; item.Url = version.Url; item.Tags = version.Tags; item.Group = version.Group;
            item.Revision++; item.UpdatedAt = DateTimeOffset.UtcNow;
            db.Versions.Add(Snapshot(item));
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateConcurrencyException) { return Results.Conflict(new { error = "Mục đã thay đổi trên thiết bị khác." }); }
            return Results.Ok(item);
        });
        group.MapPost("/{id:guid}/state", async (Guid id, StateInput input, ClaimsPrincipal user, AppDbContext db) =>
        {
            var item = await db.Items.SingleOrDefaultAsync(x => x.Id == id && x.UserId == user.UserId());
            if (item is null) return Results.NotFound();
            if (item.Revision != input.Revision) return Results.Conflict(new { error = "Mục đã thay đổi trên thiết bị khác.", current = item });
            switch (input.Action)
            {
                case "delete": item.DeletedAt = DateTimeOffset.UtcNow; break;
                case "restore": item.DeletedAt = null; break;
                case "archive": item.ArchivedAt = DateTimeOffset.UtcNow; break;
                case "unarchive": item.ArchivedAt = null; break;
                case "pin": item.IsPinned = true; break;
                case "unpin": item.IsPinned = false; break;
                default: return Results.BadRequest(new { error = "Thao tác không hợp lệ." });
            }
            item.Revision++; item.UpdatedAt = DateTimeOffset.UtcNow;
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateConcurrencyException) { return Results.Conflict(new { error = "Mục đã thay đổi trên thiết bị khác." }); }
            return Results.Ok(item);
        });
    }

    private static string? Validate(ItemInput input)
    {
        if (input.Kind is null || !Kinds.Contains(input.Kind)) return "Loại mục không hợp lệ.";
        if (input.Title is null || input.Body is null || input.Tags is null || input.Group is null) return "Thiếu nội dung bắt buộc.";
        if (input.Title.Length > 300 || input.Body.Length > 100_000 || (input.Url?.Length ?? 0) > 2048 || input.Group.Length > 120) return "Nội dung quá dài.";
        if (input.Tags.Length > 1000 || input.Tags.Split(',', StringSplitOptions.RemoveEmptyEntries).Length > 20) return "Quá nhiều thẻ.";
        if (input.Kind == "link" && (!Uri.TryCreate(input.Url, UriKind.Absolute, out var uri) || (uri.Scheme != "https" && uri.Scheme != "http"))) return "URL phải dùng http hoặc https.";
        return null;
    }
    private static void Apply(SavedItem item, ItemInput input)
    {
        item.Kind = input.Kind;
        item.Title = input.Title.Trim();
        item.Body = input.Body;
        item.Url = input.Kind == "link" ? input.Url : null;
        item.Tags = string.Join(',', input.Tags.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct(StringComparer.OrdinalIgnoreCase));
        item.Group = input.Group.Trim();
        item.IsPinned = input.IsPinned;
    }
    private static ItemVersion Snapshot(SavedItem x) => new() { UserId = x.UserId, ItemId = x.Id, Number = x.Revision, Title = x.Title, Body = x.Body, Url = x.Url, Tags = x.Tags, Group = x.Group };
    public sealed record ItemInput(string Kind, string Title, string Body, string? Url, string Tags, string Group, bool IsPinned, int Revision);
    public sealed record RestoreInput(int Revision);
    public sealed record StateInput(string Action, int Revision);
}
