import { NotFoundException } from "@nestjs/common";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityContributionController } from "./capability-contribution.controller";

describe("CapabilityContributionController download responses", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "sep-contribution-download-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function makeController() {
    const service = {
      getRpaPackage: jest.fn(),
      getVersionPackage: jest.fn(),
    };
    const skillPackage = { resolveStoredPath: jest.fn() };
    const rpaPackage = { resolveStoredPath: jest.fn() };
    const controller = new CapabilityContributionController(
      service as never,
      skillPackage as never,
      {} as never,
      rpaPackage as never,
    );
    return { controller, service, skillPackage, rpaPackage };
  }

  function response() {
    return {
      setHeader: jest.fn(),
      download: jest.fn(),
    };
  }

  it("returns RPA integrity and length headers before downloading the file", async () => {
    const { controller, service, rpaPackage } = makeController();
    const path = join(directory, "rpa.zip");
    writeFileSync(path, Buffer.from("rpa-payload"));
    const res = response();
    rpaPackage.resolveStoredPath.mockReturnValue(path);
    service.getRpaPackage.mockResolvedValue({
      key: "rpa/a.zip",
      sha256: "a".repeat(64),
      filename: "报表流程.zip",
      version: "2.0.0",
    });

    await controller.downloadRpaPackage(
      {
        user: { id: "user-1" },
        ip: "127.0.0.1",
        headers: { "user-agent": "test" },
      } as never,
      "cap-1",
      undefined,
      res as never,
    );

    expect(service.getRpaPackage).toHaveBeenCalledWith("user-1", "cap-1", undefined, {
      ip: "127.0.0.1",
      userAgent: "test",
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/zip",
    );
    expect(res.setHeader).toHaveBeenCalledWith("Content-Length", 11);
    expect(res.setHeader).toHaveBeenCalledWith("X-SHA256", "a".repeat(64));
    expect(res.setHeader).toHaveBeenCalledWith("X-Version", "2.0.0");
    expect(res.download).toHaveBeenCalledWith(path, "报表流程.zip");
  });

  it("forwards an explicit RPA version id", async () => {
    const { controller, service, rpaPackage } = makeController();
    const path = join(directory, "rpa-v2.zip");
    writeFileSync(path, Buffer.from("rpa-payload"));
    const res = response();
    rpaPackage.resolveStoredPath.mockReturnValue(path);
    service.getRpaPackage.mockResolvedValue({
      key: "rpa/v2.zip",
      sha256: "b".repeat(64),
      version: "2.0.0",
      filename: "流程-v2.zip",
    });

    await controller.downloadRpaPackage(
      { user: { id: "user-1" }, headers: {} } as never,
      "cap-1",
      "rpa-version-2",
      res as never,
    );

    expect(service.getRpaPackage).toHaveBeenCalledWith("user-1", "cap-1", "rpa-version-2", {
      ip: undefined,
      userAgent: undefined,
    });
    expect(res.setHeader).toHaveBeenCalledWith("X-Version", "2.0.0");
  });

  it("returns a safe 404 when the authorized RPA object is missing", async () => {
    const { controller, service, rpaPackage } = makeController();
    const res = response();
    rpaPackage.resolveStoredPath.mockReturnValue(
      join(directory, "missing.zip"),
    );
    service.getRpaPackage.mockResolvedValue({
      key: "rpa/a.zip",
      sha256: "a".repeat(64),
      filename: "报表流程.zip",
    });

    await expect(
      controller.downloadRpaPackage(
        { user: { id: "user-1" } } as never,
        "cap-1",
        undefined,
        res as never,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(res.download).not.toHaveBeenCalled();
  });

  it("returns Skill integrity headers and version metadata", async () => {
    const { controller, service, skillPackage } = makeController();
    const path = join(directory, "skill.zip");
    writeFileSync(path, Buffer.from("skill-payload"));
    const res = response();
    skillPackage.resolveStoredPath.mockReturnValue(path);
    service.getVersionPackage.mockResolvedValue({
      key: "skills/a.zip",
      sha256: "a".repeat(64),
      version: "1.2.0",
      filename: "周报.zip",
    });

    await controller.downloadVersionPackage(
      { user: { id: "reader-1", role: "USER" }, headers: {} } as never,
      "version-1",
      res as never,
    );

    expect(service.getVersionPackage).toHaveBeenCalledWith(
      "reader-1",
      "version-1",
      "USER",
      {
        ip: undefined,
        userAgent: undefined,
      },
    );
    expect(res.setHeader).toHaveBeenCalledWith("X-Version", "1.2.0");
    expect(res.setHeader).toHaveBeenCalledWith("X-SHA256", "a".repeat(64));
    expect(res.download).toHaveBeenCalledWith(path, "周报.zip");
  });
});

describe("CapabilityContributionController version routes", () => {
  function makeController() {
    const service = {
      getVersionDiff: jest.fn(),
      reviewEnterpriseVersion: jest.fn(),
    };
    const controller = new CapabilityContributionController(
      service as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { controller, service };
  }

  it("forwards the author identity, version id, and role to the version diff service", async () => {
    const { controller, service } = makeController();
    const expected = { changed: true };
    service.getVersionDiff.mockResolvedValue(expected);

    const result = await controller.versionDiff(
      { user: { id: "author-1", role: "USER" } } as never,
      "version-2",
    );

    expect(result).toBe(expected);
    expect(service.getVersionDiff).toHaveBeenCalledWith(
      "author-1",
      "version-2",
      "USER",
    );
  });

  it("forwards the enterprise reviewer identity, version id, and decision", async () => {
    const { controller, service } = makeController();
    const decision = { decision: "REJECT" as const, comment: "需要补充变更说明" };
    const expected = { status: "REJECTED" };
    service.reviewEnterpriseVersion.mockResolvedValue(expected);

    const result = await controller.enterpriseReviewVersion(
      { user: { id: "enterprise-admin-1" } } as never,
      "version-2",
      decision,
    );

    expect(result).toBe(expected);
    expect(service.reviewEnterpriseVersion).toHaveBeenCalledWith(
      "enterprise-admin-1",
      "version-2",
      decision,
    );
  });
});
