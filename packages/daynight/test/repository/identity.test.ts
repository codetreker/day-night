import { describe, expect, it } from "vitest";
import { RepositoryIdentityError, repositoryIdentity } from "../../src/repository/identity.js";

const identities: readonly (readonly [string, string])[] = [
  ["https://GitHub.com/Org/Repo.git/", "github.com/Org/Repo"],
  ["ssh://git@github.com:22/Org/Repo.git", "github.com/Org/Repo"],
  ["git@github.com:Org/Repo.git", "github.com/Org/Repo"],
  ["https://github.com:443/Org/Repo", "github.com/Org/Repo"],
  ["https://github.com/org/repo", "github.com/org/repo"],
  ["https://git.example/Group/Sub/Repo.git", "git.example/Group/Sub/Repo"],
  ["https://git.example:8443/Group/Repo.git", "https://git.example:8443/Group/Repo"],
  ["ssh://git@git.example:2222/Group/Repo.git", "ssh://git@git.example:2222/Group/Repo"],
  ["ssh://alice@git.example/Group/Repo.git", "ssh://alice@git.example/Group/Repo"],
  ["alice@git.example:Group/Repo.git", "scp://alice@git.example:Group/Repo"],
  ["ssh://git.example/Group/Repo.git", "ssh://git.example/Group/Repo"],
  ["git@work-github:Org/Repo.git", "work-github/Org/Repo"],
  ["git@git.example:./Group/Repo.git", "scp://git@git.example:./Group/Repo"],
  ["git@git.example:../Group/Repo.git", "scp://git@git.example:../Group/Repo"],
  ["git@git.example:/Group/Repo.git", "scp://git@git.example:/Group/Repo"],
  ["git@git.example:~/Group/Repo.git", "scp://git@git.example:~/Group/Repo"],
  ["ssh://git@git.example/~/Repo.git", "ssh://git@git.example/~/Repo"],
  ["https://git.example/Org/Repo%2Egit", "git.example/Org/Repo%2Egit"],
  ["https://git.example/Org/%52epo.git", "git.example/Org/%52epo"],
  ["https://git.example/Org/Repo.git.git", "git.example/Org/Repo.git"],
  ["https://git.example/Org/Repo.GIT", "git.example/Org/Repo.GIT"],
  ["https://git.example/.git", "git.example/.git"],
  ["git@git.example:.git", "git.example/.git"],
  ["https://git.example//.git///", "https://git.example//.git"],
  ["git@git.example:/.git///", "scp://git@git.example:/.git"],
  ["https://git.example/group/.git", "https://git.example/group/"],
  ["git@git.example:group/.git", "scp://git@git.example:group/"],
  ["HTTPS://Git.Example./group/repo", "git.example./group/repo"],
  ["https://127.0.0.1:443/repo", "127.0.0.1/repo"],
  ["https://127.1/repo", "127.1/repo"],
  ["https://0x7f000001/repo", "0x7f000001/repo"],
  ["https://[::1]:443/repo", "[::1]/repo"],
  ["ssh://git@[2001:0DB8:0:0:0:0:0:1]:2222/repo", "ssh://git@[2001:db8::1]:2222/repo"],
  ["git@[2001:0DB8::1]:team/repo", "[2001:db8::1]/team/repo"],
  ["[::1]:repo", "scp://[::1]:repo"],
  ["git@[127.0.0.1]:team/repo", "127.0.0.1/team/repo"],
  ["https://[::ffff:192.0.2.1]/repo", "[::ffff:192.0.2.1]/repo"],
  ["https://[::ffff:c000:201]/repo", "[::ffff:192.0.2.1]/repo"],
  ["ssh://git@::1:22/repo", "[::1]/repo"],
  ["https://host/repo%20name", "host/repo%20name"],
  ["https://host/repo%20name%20", "host/repo%20name%20"],
  ["https://host/repo%2fpart", "host/repo%2fpart"],
  ["https://host/repo%2Fpart", "host/repo%2Fpart"],
  ["https://host/%2E%2E/repo", "host/%2E%2E/repo"],
  ["https://host/group/../repo", "https://host/group/../repo"],
  ["https://host/group/./repo", "https://host/group/./repo"],
  ["https://host/group//repo", "https://host/group//repo"],
  ["https://host/group\\repo", "host/group\\repo"],
  ["https://host/group/repo///", "host/group/repo"],
  ["ssh://git@example.com/team/repo.git", "example.com/team/repo"],
  ["ssh://example.com/repo", "ssh://example.com/repo"],
  ["ssh://git@example.com:2222/~git/repo", "ssh://git@example.com:2222/~git/repo"],
  ["git@example.com:team/repo.git", "example.com/team/repo"],
  ["example.com:repo", "scp://example.com:repo"],
  ["server:repo:tag", "scp://server:repo:tag"],
  ["git@host:org/repo@next.git", "host/org/repo@next"],
  ["host:repo@next.git", "scp://host:repo@next"],
  ["git@host:repo@next:tag.git", "host/repo@next:tag"],
  ["git@build_alias:org/repo.git", "build_alias/org/repo"],
  ["ssh://git@build_alias/org/repo.git", "build_alias/org/repo"],
  ["https://build_alias/org/repo.git", "build_alias/org/repo"],
  ["https://-host/repo", "-host/repo"],
  ["https://host-/repo", "host-/repo"],
  ["https://a..b/repo", "a..b/repo"],
  [`https://${"a".repeat(64)}/repo`, `${"a".repeat(64)}/repo`],
  [`https://${"a.".repeat(128)}a/repo`, `${"a.".repeat(128)}a/repo`],
  ["ssh://git@host!name/repo", "host!name/repo"],
  ["git@服务:repo", "服务/repo"],
  ["https://服务/组/仓库", "服务/组/仓库"],
  ["https://ÉXAMPLE/Repo", "éxample/Repo"],
  ["https://%C3%89XAMPLE/Repo", "éxample/Repo"],
  ["https://host/repo\uFEFFname", "host/repo\uFEFFname"],
  ["git@host:repo\uFEFFname", "host/repo\uFEFFname"],
  ["https://host/repo%EF%BB%BFname", "host/repo%EF%BB%BFname"],
  ["https://host/repo%C2%A0name", "host/repo%C2%A0name"],
  ["https://HOST:00443/Repo.git", "host/Repo"],
  ["ssh://git@HOST:00022/Repo.git", "host/Repo"],
  ["ssh://git@HOST:0002222/Repo.git", "ssh://git@host:2222/Repo"],
  ["ssh://Git@HOST/Repo.git", "ssh://Git@host/Repo"],
  ["ssh://%67it@HOST/Repo.git", "ssh://%67it@host/Repo"],
  ["开发者@host:repo", "scp://开发者@host:repo"],
  ["ssh://%E5%BC%80%E5%8F%91%E8%80%85@host/repo", "ssh://%E5%BC%80%E5%8F%91%E8%80%85@host/repo"],
  ["git@host-._~!$&'()*+,;=:Repo", "host-._~!$&'()*+,;=/Repo"],
  ["https://host-._~!$&'()*+,;=/Repo", "host-._~!$&'()*+,;=/Repo"],
  ["ssh://user%3Aname@host/repo", "ssh://user%3Aname@host/repo"],
  ["ssh://user@other@host/repo", "ssh://user@other@host/repo"],
  ["git@host:%2F", "host/%2F"],
];

const invalid = [
  "", " ", "https://host/repo name", "https://host/repo\n", "https://host/\u007frepo", "https://host/repo\u2003name",
  "https://host/%00repo", "https://host/%0Arepo", "https://host/%7Frepo", "https://host/%zz", "https://host/bad\uD800path", "https://host/%ffpath",
  "https:///repo", "https://host", "https://host/", "https://host///", "https://host:0/repo", "https://host:65536/repo", "https://host:/repo", "https://host:abc/repo", "https://[bad]/repo", "https://host\\name/repo",
  "https://token@host/repo", "https://user:password@host/repo", "https://host/repo?", "https://host/repo?token=secret", "https://host/repo#", "https://host/repo#branch",
  "ssh://user:secret@host/repo", "ssh://user:@host/repo", "ssh://@host/repo", "ssh://host/repo?key=secret", "ssh://host/repo#ref", "git://host/repo", "http://host/repo", "file:///repo",
  "host", ":repo", "host:", "host:///", "@host:repo", "user:password@host:repo", "user/name@host:repo", "user[name]@host:repo", "user@other@host:repo", "[::1]repo", "[host]:repo", "host:repo?query", "host:repo#fragment",
  "https://[127.0.0.1]/repo", "https://host/%2f", "https://host/%C2%85repo", "https://host/repo\u0085name", "git@host:repo\u0085name", "ssh://git@[fe80::1%25eth0]/repo",
  "ssh://开发者@host/repo", "https://%65xample/repo", "https://ho%2Fst/repo", "https://ho[st/repo", "https://[::1]extra/repo", "git@[bad]:repo", "git@[fe80::1%eth0]:repo", "https://::1:443/repo", "ssh://git@::1/repo",
  "https://host/%ED%A0%80", "https://host/%EF%BF%BE\u200B\u0000",
];

describe("repositoryIdentity", () => {
  it.each(identities)("normalizes %s to its exact repository identity", (input, expected) => {
    expect(repositoryIdentity(input)).toBe(expected);
  });

  it.each(invalid)("rejects invalid server repository syntax %j", (input) => {
    expect(() => repositoryIdentity(input)).toThrow(RepositoryIdentityError);
  });

  it("merges only the confirmed ordinary hosted transport forms", () => {
    const forms = ["https://GitHub.com/Org/Repo.git/", "ssh://git@github.com:22/Org/Repo.git", "git@github.com:Org/Repo.git"];
    expect(new Set(forms.map(repositoryIdentity))).toEqual(new Set(["github.com/Org/Repo"]));
    for (const address of ["https://github.com/org/repo", "https://github.com:8443/Org/Repo", "ssh://alice@github.com/Org/Repo", "ssh://github.com/Org/Repo", "git@alias:Org/Repo", "git@github.com:./Org/Repo", "git@github.com:/Org/Repo"]) {
      expect(repositoryIdentity(address)).not.toBe(repositoryIdentity(forms[0]!));
    }
  });

  it("does not expose credential-bearing input in diagnostics", () => {
    const input = "ssh://private-user:private-password@host/repo";
    try { repositoryIdentity(input); throw new Error("Expected rejection"); }
    catch (error) {
      expect(error).toBeInstanceOf(RepositoryIdentityError);
      expect(String(error)).not.toContain("private-user");
      expect(String(error)).not.toContain("private-password");
    }
  });
});
