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
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => { });
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => { });

        const log = createLogger("test");
        log.error("err");
        log.warn("wrn");
        log.info("inf");
        log.debug("dbg");

        // error level: only error is logged (via console.error)
        expect(errSpy).toHaveBeenCalledOnce();
        expect(logSpy).not.toHaveBeenCalled();

        errSpy.mockRestore();
        logSpy.mockRestore();
    });

    it("should respect log level: info shows error+warn+info", () => {
        setLogLevel("info");
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => { });
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => { });

        const log = createLogger("test");
        log.error("err");
        log.warn("wrn");
        log.info("inf");
        log.debug("dbg");

        // error + warn go to console.error (2 calls)
        expect(errSpy).toHaveBeenCalledTimes(2);
        // info goes to console.log (1 call), debug is suppressed
        expect(logSpy).toHaveBeenCalledOnce();

        errSpy.mockRestore();
        logSpy.mockRestore();
    });

    it("should respect log level: debug shows everything", () => {
        setLogLevel("debug");
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => { });
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => { });

        const log = createLogger("test");
        log.error("err");
        log.warn("wrn");
        log.info("inf");
        log.debug("dbg");

        // error + warn → console.error (2 calls)
        expect(errSpy).toHaveBeenCalledTimes(2);
        // info + debug → console.log (2 calls)
        expect(logSpy).toHaveBeenCalledTimes(2);

        errSpy.mockRestore();
        logSpy.mockRestore();
    });

    it("should include tag and data in output", () => {
        setLogLevel("info");
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => { });

        const log = createLogger("myTag");
        log.info("hello", { foo: "bar" });

        expect(logSpy).toHaveBeenCalledOnce();
        const output = logSpy.mock.calls[0][0] as string;
        expect(output).toContain("[myTag]");
        expect(output).toContain("hello");
        expect(output).toContain('"foo":"bar"');

        logSpy.mockRestore();
    });

    it("should get/set log level", () => {
        setLogLevel("debug");
        expect(getLogLevel()).toBe("debug");
        setLogLevel("error");
        expect(getLogLevel()).toBe("error");
    });
});
