import { cyclingPowerDriver, wahooDriver } from "./cyclingPower.ts";
import { ftmsDriver } from "./ftms.ts";
import type { ProtocolDriver } from "./protocol.ts";
import { tacxFecDriver } from "./tacxFec.ts";

export { cyclingPowerDriver, ftmsDriver, tacxFecDriver, wahooDriver };
export type { ProtocolContext, ProtocolDriver, TrainerProtocol } from "./protocol.ts";
export { UnsupportedError } from "./protocol.ts";

/**
 * Drivers tried in order; the first one that recognises the device wins.
 * FTMS first (the standard), then vendor protocols, then read-only power.
 */
export const defaultDrivers: readonly ProtocolDriver[] = [ftmsDriver, tacxFecDriver, wahooDriver, cyclingPowerDriver];
