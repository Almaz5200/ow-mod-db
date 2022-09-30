import * as core from "@actions/core";
import { sendDiscordNotifications } from "./send-discord-notifications";
import { fetchMods } from "./fetch-mods";
import { getDiff } from "./get-diff";
import { getPreviousDatabase } from "./get-previous-database";
import { fetchModManager } from "./fetch-mod-manager";
import { toJsonString } from "./to-json-string";
import { getViewCounts } from "./get-view-counts";
import { getInstallCounts } from "./get-install-counts";

import { writeFile } from "fs";
import { TypeOfExpression } from "typescript";

enum Input {
  outFile = "out-file",
  mods = "mods",
  discordHookUrl = "discord-hook-url",
  discordModUpdateRoleId = "discord-mod-update-role-id",
  discordNewModRoleId = "discord-new-mod-role-id",
  discordModHookUrls = "discord-mod-hook-urls",
  googleServiceAccount = "google-service-account",
}

enum Output {
  releases = "releases",
}

function getCleanedUpModList(modList: Mod[]) {
  return modList.map(
    ({ latestReleaseDescription, latestPrereleaseDescription, ...mod }) => mod
  );
}

// Caution: this function needs to match the same one in the outerwildsmods.com repo.
// This should probably just be saved in the database to avoid the double work.
export const getModPathName = (modName: string) =>
  modName.replace(/\W/g, "").toLowerCase();

const getSettledResult = <TResult>(
  results: PromiseSettledResult<TResult>,
  name: string,
  initialTime: number
): TResult | undefined => {
  if (results.status == "rejected") return undefined;

  console.log(
    `Finished getting ${name} in ${performance.now() - initialTime} ms`
  );

  return results.value;
};

async function getAsyncStuff() {
  const promises = [
    fetchModManager(),
    fetchMods(core.getInput(Input.mods)),
    getViewCounts(core.getInput(Input.googleServiceAccount)),
    getInstallCounts(core.getInput(Input.googleServiceAccount)),
    getPreviousDatabase(),
  ] as const;

  const initialTime = performance.now();

  const [
    modManager,
    nextDatabase,
    viewCounts,
    installCounts,
    previousDatabase,
  ] = await Promise.allSettled(promises);

  return {
    modManager: getSettledResult(modManager, "modManager", initialTime),
    nextDatabase:
      getSettledResult(nextDatabase, "nextDatabase", initialTime) ?? [],
    viewCounts: getSettledResult(viewCounts, "viewCounts", initialTime) ?? {},
    installCounts:
      getSettledResult(installCounts, "installCounts", initialTime) ?? {},
    previousDatabase:
      getSettledResult(previousDatabase, "previousDatabase", initialTime) ?? [],
  };
}

async function run() {
  try {
    const {
      modManager,
      nextDatabase,
      viewCounts,
      installCounts,
      previousDatabase,
    } = await getAsyncStuff();

    const cleanedUpModList = getCleanedUpModList(nextDatabase);

    const modListWithAnalytics = cleanedUpModList.map((mod) => ({
      ...mod,
      viewCount: viewCounts[getModPathName(mod.name)] ?? 0,
      installCount: installCounts[mod.uniqueName] ?? 0,
    }));

    const databaseJson = toJsonString({
      modManager,
      releases: modListWithAnalytics.filter(({ alpha }) => !alpha),
      alphaReleases: modListWithAnalytics.filter(({ alpha }) => alpha),
    });
    core.setOutput(Output.releases, databaseJson);

    const outputFilePath = core.getInput(Input.outFile);

    if (outputFilePath) {
      writeFile(outputFilePath, databaseJson, (error) => {
        if (error) console.log("Error Saving To File:", error);
      });
    }

    const discordHookUrl = core.getInput(Input.discordHookUrl);

    if (discordHookUrl) {
      const diff = getDiff(previousDatabase, nextDatabase);

      const discordModHookUrls: Record<string, string> = JSON.parse(
        core.getInput(Input.discordModHookUrls) || "{}"
      );

      sendDiscordNotifications(
        core.getInput(Input.discordHookUrl),
        core.getInput(Input.discordModUpdateRoleId),
        core.getInput(Input.discordNewModRoleId),
        diff,
        discordModHookUrls
      );
    }
  } catch (error) {
    core.setFailed(error as any);
    console.log("error", error as any);
  }
}

run();
