using Microsoft.EntityFrameworkCore;

namespace Tucknote.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<LoginSession> Sessions => Set<LoginSession>();
    public DbSet<SavedItem> Items => Set<SavedItem>();
    public DbSet<ItemVersion> Versions => Set<ItemVersion>();
    public DbSet<VaultProfile> VaultProfiles => Set<VaultProfile>();
    public DbSet<VaultEntry> VaultEntries => Set<VaultEntry>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<AppUser>().HasIndex(x => x.Email).IsUnique();
        model.Entity<LoginSession>().HasIndex(x => new { x.UserId, x.RevokedAt });
        model.Entity<SavedItem>().HasIndex(x => new { x.UserId, x.Kind, x.UpdatedAt });
        model.Entity<SavedItem>().HasIndex(x => new { x.UserId, x.DeletedAt });
        model.Entity<ItemVersion>().HasIndex(x => new { x.UserId, x.ItemId, x.Number }).IsUnique();
        model.Entity<VaultProfile>().HasKey(x => x.UserId);
        model.Entity<VaultEntry>().HasIndex(x => new { x.UserId, x.DeletedAt });
        model.Entity<SavedItem>().Property(x => x.Title).HasMaxLength(300);
        model.Entity<SavedItem>().Property(x => x.Revision).IsConcurrencyToken();
        model.Entity<VaultEntry>().Property(x => x.Revision).IsConcurrencyToken();
        model.Entity<SavedItem>().Property(x => x.Url).HasMaxLength(2048);
        model.Entity<SavedItem>().Property(x => x.Group).HasMaxLength(120);
        model.Entity<AppUser>().Property(x => x.Email).HasMaxLength(320);
    }
}

public sealed class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string SecurityStamp { get; set; } = Guid.NewGuid().ToString("N");
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class LoginSession
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset LastSeenAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? RevokedAt { get; set; }
    public string Device { get; set; } = "";
}

public sealed class SavedItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string Kind { get; set; } = "inbox";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public string? Url { get; set; }
    public string Tags { get; set; } = "";
    public string Group { get; set; } = "";
    public bool IsPinned { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public int Revision { get; set; } = 1;
}

public sealed class ItemVersion
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid ItemId { get; set; }
    public int Number { get; set; }
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public string? Url { get; set; }
    public string Tags { get; set; } = "";
    public string Group { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class VaultProfile
{
    public Guid UserId { get; set; }
    public string Salt { get; set; } = "";
    public int Iterations { get; set; }
    public string WrappedKey { get; set; } = "";
    public string MasterIv { get; set; } = "";
    public string RecoveryWrappedKey { get; set; } = "";
    public string RecoveryIv { get; set; } = "";
}

public sealed class VaultEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string Ciphertext { get; set; } = "";
    public string Iv { get; set; } = "";
    public int Revision { get; set; } = 1;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? DeletedAt { get; set; }
}
