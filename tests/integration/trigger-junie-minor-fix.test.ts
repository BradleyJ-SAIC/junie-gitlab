import { describe, test, before, after } from "node:test";
import assert from "node:assert";
import {JUNIE_STARTED_MESSAGE, JUNIE_FINISHED_PREFIX} from "../../src/constants/gitlab.js";
import {
    initApi,
    createBranch, createRepositoryFile,
    createMergeRequest,
    addMergeRequestNote,
    waitForMRComment, waitForMRFileContent, checkMergeRequestFiles,
} from "../../src/api/gitlab-api.js";
import {gitLabConfig} from "../config/config.js";
import {LocalGitLabFixture} from "../fixtures/local-gitlab-fixture.js";

const expect = (actual: any, message?: string) => ({
    toBe: (expected: any) => assert.strictEqual(actual, expected, message),
});

describe("Trigger Junie minor-fix in MR comment", () => {
    const fixture = new LocalGitLabFixture();
    let projectId: number;
    let defaultBranch: string;
    let mrIid: number | undefined;
    let testPassed = false;

    before(async () => {
        initApi(gitLabConfig.gitlabHost, gitLabConfig.gitlabToken);
        const handle = await fixture.create("test-minor-fix", "--mr-mode append");
        projectId = handle.projectId;
        defaultBranch = handle.defaultBranch;
        console.log(`Created isolated project #${projectId} (${handle.webUrl}), default branch: ${defaultBranch}`);
    });

    after(async () => {
        await fixture.destroy({testPassed});
    });

    test("apply minor-fix rename to MR based on #junie minor-fix comment", { timeout: 900000 }, async () => {
        const timestamp = Date.now();
        const branchName = `feature/string-utils-${timestamp}`;
        const filename = "string_utils.py";
        const originalFunctionName = "process_data";
        const renamedFunctionName = "handle_user_data";
        const content = `def ${originalFunctionName}(items):\n    return [i.strip() for i in items]\n`;

        console.log(`Creating branch: ${branchName} (from ${defaultBranch})`);
        await createBranch(projectId, branchName, defaultBranch);
        console.log(`Adding ${filename} with function ${originalFunctionName}() on ${branchName}`);
        await createRepositoryFile(projectId, filename, branchName, content, "Add string utils");

        const mrTitle = `Add string utilities ${timestamp}`;
        console.log(`Creating MR "${mrTitle}" from ${branchName} into ${defaultBranch}`);
        const mr = await createMergeRequest(projectId, branchName, defaultBranch, mrTitle, '');
        mrIid = (mr as any).iid;
        console.log(`MR created: #${mrIid} ${(mr as any).web_url}`);

        const commentBody = `#junie minor-fix rename function ${originalFunctionName} to ${renamedFunctionName} in ${filename}`;
        console.log(`Commenting on MR #${mrIid}: "${commentBody}"`);
        await addMergeRequestNote(projectId, mrIid!, commentBody);

        console.log("Waiting for Junie's started comment on MR...");
        await waitForMRComment(projectId, mrIid!, JUNIE_STARTED_MESSAGE);
        console.log("Junie started processing.");

        console.log("Waiting for Junie's finished comment on MR...");
        await waitForMRComment(projectId, mrIid!, JUNIE_FINISHED_PREFIX);
        console.log("Junie posted the finish message.");

        console.log(`Waiting for renamed function ${renamedFunctionName} to appear in ${filename}...`);
        await waitForMRFileContent(projectId, mrIid!, filename, renamedFunctionName);
        console.log(`Renamed function detected in ${filename}.`);

        console.log("Verifying renamed function is present in the MR diff...");
        const result = await checkMergeRequestFiles(projectId, mrIid!, {
            [filename]: renamedFunctionName,
        });
        expect(result, "MR files check failed - renamed function not found in diff").toBe(true);
        console.log(`MR diff check passed: ${filename} contains ${renamedFunctionName}.`);

        console.log("Junie finished processing the minor-fix.");
        testPassed = true;
    });
});
