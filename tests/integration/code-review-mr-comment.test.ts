import {describe, test, before, after} from "node:test";
import assert from "node:assert/strict";
import {JUNIE_STARTED_MESSAGE, JUNIE_FINISHED_PREFIX} from "../../src/constants/gitlab.js";
import {
    initApi,
    createBranch, createRepositoryFile,
    createMergeRequest,
    addMergeRequestNote,
    waitForMRComment,
    waitForMRInlineNotes, getMRInlineNotes,
} from "../../src/api/gitlab-api.js";
import {gitLabConfig} from "../config/config.js";
import {LocalGitLabFixture} from "../fixtures/local-gitlab-fixture.js";

describe("Code Review", () => {
    const fixture = new LocalGitLabFixture();
    let projectId: number;
    let defaultBranch: string;
    let testPassed = false;

    before(async () => {
        initApi(gitLabConfig.gitlabHost, gitLabConfig.gitlabToken);
        const handle = await fixture.create("test-code-review", "--mr-mode append");
        projectId = handle.projectId;
        defaultBranch = handle.defaultBranch;
        console.log(`Created isolated project #${projectId} (${handle.webUrl}), default branch: ${defaultBranch}`);
    });

    after(async () => {
        await fixture.destroy({testPassed});
    });

    test("on-demand via '#junie code-review' comment", {timeout: 900_000}, async () => {
        await runCodeReviewTest('ondemand', '#junie code-review');
        testPassed = true;
    });

    test("automatic on MR open", {timeout: 900_000}, async () => {
        await runCodeReviewTest('auto');
        testPassed = true;
    });

    async function runCodeReviewTest(suffix: string, triggerComment?: string) {
        const timestamp = Date.now();
        const branchName = `feature/${suffix}-${timestamp}`;

        console.log(`[${suffix}] Creating branch ${branchName} from ${defaultBranch}...`);
        await createBranch(projectId, branchName, defaultBranch);
        await createRepositoryFile(projectId, `src/app_${suffix}.py`, branchName,
            "def avg(arr:\n    total = sum(arr)\n    return total / len(arr) if arr else 0\n",
            `Add code for ${suffix}`);
        await createRepositoryFile(projectId, `src/stats_${suffix}.py`, branchName,
            "def multiply(a, b:\n    return a * b\n",
            `Add stats for ${suffix}`);

        console.log(`[${suffix}] Opening MR...`);
        const mr = await createMergeRequest(projectId, branchName, defaultBranch,
            `Code review ${suffix} ${timestamp}`, '');
        const mrIid = (mr as any).iid;
        console.log(`[${suffix}] MR #${mrIid}: ${(mr as any).web_url}`);

        if (triggerComment) {
            console.log(`[${suffix}] Posting trigger comment: "${triggerComment}"`);
            await addMergeRequestNote(projectId, mrIid!, triggerComment);
        } else {
            console.log(`[${suffix}] No comment posted — waiting for auto-trigger on MR open.`);
        }

        console.log(`[${suffix}] Waiting for Junie to start...`);
        await waitForMRComment(projectId, mrIid!, JUNIE_STARTED_MESSAGE);
        console.log(`[${suffix}] Junie started. Waiting for ≥2 inline notes...`);
        await waitForMRInlineNotes(projectId, mrIid!, 2);

        const notes = await getMRInlineNotes(projectId, mrIid!, n => {
            const body = (n.body || "") as string;
            return body.includes("multiply(a, b") || body.includes("avg(arr");
        });
        assert.ok(notes.length >= 2,
            `Expected more or equal than 2 inline notes, got ${notes.length}:\n${notes.map(n => n.body).join('\n---\n')}`);

        console.log(`[${suffix}] Got ${notes.length} inline notes. Waiting for finish message...`);
        await waitForMRComment(projectId, mrIid!, JUNIE_FINISHED_PREFIX);
        console.log(`[${suffix}] Junie finished code review.`);
    }
});
