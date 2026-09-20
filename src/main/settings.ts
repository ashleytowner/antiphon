import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { isIPv4 } from "node:net";
import type { Settings } from "../shared/types";

export const defaults: Settings = {
  libraryRoot: "",
  port: 3000,
  udpMin: 40000,
  udpMax: 40031,
  publicAddress: "",
  stunUrl: "",
  turnUrl: "",
  turnUsername: "",
  turnCredential: "",
};
export function validateSettings(value: Settings): Settings {
  if (!value || typeof value !== "object") throw new Error("Invalid settings.");
  for (const field of [
    "libraryRoot",
    "publicAddress",
    "stunUrl",
    "turnUrl",
    "turnUsername",
    "turnCredential",
  ] as const) {
    if (typeof value[field] !== "string" || value[field].length > 4096)
      throw new Error(`Invalid ${field}.`);
  }
  for (const key of ["port", "udpMin", "udpMax"] as const)
    if (
      !Number.isInteger(value[key]) ||
      value[key] < 1024 ||
      value[key] > 65535
    )
      throw new Error("Ports must be integers between 1024 and 65535.");
  if (value.udpMax - value.udpMin < 31)
    throw new Error("Provide at least 32 UDP ports for concurrent listeners.");
  if (value.publicAddress && !isIPv4(value.publicAddress))
    throw new Error(
      "Public address must be an IPv4 address (without http:// or a port).",
    );
  if (value.libraryRoot && !path.isAbsolute(value.libraryRoot))
    throw new Error("Choose an absolute library folder.");
  if (value.stunUrl && !/^stun:[^\s]+$/.test(value.stunUrl))
    throw new Error("STUN URL must start with stun:.");
  if (value.turnUrl && !/^turns?:[^\s]+$/.test(value.turnUrl))
    throw new Error("TURN URL must start with turn: or turns:.");
  return {
    libraryRoot: value.libraryRoot,
    port: value.port,
    udpMin: value.udpMin,
    udpMax: value.udpMax,
    publicAddress: value.publicAddress,
    stunUrl: value.stunUrl,
    turnUrl: value.turnUrl,
    turnUsername: value.turnUsername,
    turnCredential: value.turnCredential,
  };
}
export async function loadSettings(filename: string): Promise<Settings> {
  try {
    return validateSettings({
      ...defaults,
      ...JSON.parse(await readFile(filename, "utf8")),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { ...defaults };
    throw error;
  }
}
export async function storeSettings(filename: string, value: Settings) {
  await writeFile(
    `${filename}.tmp`,
    JSON.stringify(validateSettings(value), null, 2),
    { mode: 0o600 },
  );
  await rename(`${filename}.tmp`, filename);
}
