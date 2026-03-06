import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger, setLogLevel, getLogLevel } from "../../src/lib/logger";
import type { LogLevel } from "../../src/lib/logger";

describe("logger", () => {
    let originalLevel: LogLevel;

    beforeEach(() => {
        originalLevel = getLogLevel();
    });

    afterEach(() => {
        setLogLevel(originalLevel);
    });

    it("should create a logger with tagged methods", () => {
        const log = createLogger("test");
        expect(log).toBeDefined();
        expect(typeof log.error).toBe("function");
        expect(typeof log.warn).toBe("function");
        expect(typeof log.info).toBe("function");
        expect(typeof log.debug).toBe("function");
    });

    it("should respect log level: error only", () => {
        setLogLevel("error");
        const spy = vi.spyOn(console, "error").mockImplementation(() => { });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
        const infoSpy = vi.spyOn(console, "info").mockImplementation(() => { });
        const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => { });

        const log = createLogger("test");
        log.error("err");
        log.warn("wrn");
        log.info("inf");
        log.debug("dbg");

        expect(spy).toHaveBeenCalledOnce();
        expect(warnSpy).not.toHaveBeenCalled();
        expect(infoSpy).not.toHaveBeenCalled();
        expect(debugSpy).not.toHaveBeenCalled();

        spy.mockRestore();
        warnSpy.mockRestore();
        infoSpy.mockRestore();
        debugSpy.mockRestore();
    });

    it("should respect log level: info shows error+warn+info", () => {
        setLogLevel("info");
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => { });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
        const infoSpy = vi.spyOn(console, "info").mockImplementation(() => { });
        const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => { });

        const log = createLogger("test");
        log.error("err");
        log.warn("wrn");
        log.info("inf");
        log.debug("dbg");

        expect(errSpy).toHaveBeenCalledOnce();
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(infoSpy).toHaveBeenCalledOnce();
        expect(debugSpy).not.toHaveBeenCalled();

        errSpy.mockRestore();
        warnSpy.mockRestore();
        infoSpy.mockRestore();
        debugSpy.mockRestore();
    });

    it("should respect log level: debug shows everything", () => {
        setLogLevel("debug");
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => { });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
        const infoSpy = vi.spyOn(console, "info").mockImplementation(() => { });
        const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => { });

        const log = createLogger("test");
        log.error("err");
        log.warn("wrn");
        log.info("inf");
        log.debug("dbg");

        expect(errSpy).toHaveBeenCalledOnce();
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(infoSpy).toHaveBeenCalledOnce();
        expect(debugSpy).toHaveBeenCalledOnce();

        errSpy.mockRestore();
        warnSpy.mockRestore();
        infoSpy.mockRestore();
        debugSpy.mockRestore();
    });

    it("should include tag and data in output", () => {
        setLogLevel("info");
        const infoSpy = vi.spyOn(console, "info").mockImplementation(() => { });

        const log = createLogger("myTag");
        log.info("hello", { foo: "bar" });

        expect(infoSpy).toHaveBeenCalledOnce();
        const output = infoSpy.mock.calls[0][0] as string;
        expect(output).toContain("[myTag]");
        expect(output).toContain("hello");
        expect(output).toContain('"foo":"bar"');

        infoSpy.mockRestore();
    });

    it("should get/set log level", () => {
        setLogLevel("debug");
        expect(getLogLevel()).toBe("debug");
        setLogLevel("error");
        expect(getLogLevel()).toBe("error");
    });
});
