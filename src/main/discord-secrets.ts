import { readFile, rename, writeFile } from "node:fs/promises";
import { safeStorage } from "electron";

/** Keep bot credentials separate from user-visible network settings. */
export async function loadDiscordToken(filename: string) {
  try {
    const value: unknown = JSON.parse(await readFile(filename, "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      typeof (value as { token?: unknown }).token !== "string"
    )
      throw new Error("Invalid Discord credentials.");
    if (!safeStorage.isEncryptionAvailable())
      throw new Error(
        "Protected storage is unavailable; Discord bot tokens cannot be used on this system.",
      );
    return safeStorage.decryptString(
      Buffer.from((value as { token: string }).token, "base64"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function storeDiscordToken(
  filename: string,
  token: string | null,
) {
  if (token === null) {
    await writeFile(`${filename}.tmp`, "{}", { mode: 0o600 });
  } else {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error(
        "Protected storage is unavailable; Discord bot tokens cannot be saved on this system.",
      );
    const encrypted = safeStorage.encryptString(token).toString("base64");
    await writeFile(`${filename}.tmp`, JSON.stringify({ token: encrypted }), {
      mode: 0o600,
    });
  }
  await rename(`${filename}.tmp`, filename);
}
