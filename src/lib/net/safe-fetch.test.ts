import { describe, expect, it } from "vitest";
import { isPublicAddress, safeFetch, UnsafeUrlError } from "./safe-fetch";

describe("isPublicAddress", () => {
  it("rejects private, loopback, link-local and metadata addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPublicAddress(a), a).toBe(false);
    }
  });
  it("accepts public addresses", () => {
    for (const a of ["8.8.8.8", "151.101.1.69", "2606:4700::6810:84e5"]) expect(isPublicAddress(a), a).toBe(true);
  });
});

describe("safeFetch", () => {
  it("refuses non-http schemes and private hosts before connecting", async () => {
    await expect(safeFetch("file:///etc/passwd")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetch("http://127.0.0.1:5432/")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetch("http://[::1]/")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetch("http://user:pw@example.com/")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetch("http://localhost:3000/")).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});
