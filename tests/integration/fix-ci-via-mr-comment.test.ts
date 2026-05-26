import { describe, test, before, after } from "node:test";
import { JUNIE_STARTED_MESSAGE, JUNIE_FINISHED_PREFIX } from "../../src/constants/gitlab.js";
import {
    createRepositoryFile,
    createMergeRequest,
    addMergeRequestNote,
    waitForFailedPipeline,
    waitForMRComment,
    waitForMRFileNotContains,
    getRepositoryFile,
    updateRepositoryFile,
    createBranch,
} from "../../src/api/gitlab-api.js";
import { LocalGitLabFixture } from "../fixtures/local-gitlab-fixture.js";

describe("Fix Failing CI via MR comment", () => {
    const fixture = new LocalGitLabFixture();
    let projectId: number;
    let defaultBranch: string;

    let branchName: string | undefined;
    let mrIid: number | undefined;
    let testPassed = false;

    before(async () => {
        const handle = await fixture.create("fix-ci", "--mr-mode append");
        projectId = handle.projectId;
        defaultBranch = handle.defaultBranch;
    });

    after(async () => {
        await fixture.destroy({ testPassed });
    });

    test("Junie fixes failing CI on #junie fix-ci comment", {timeout: 1200000}, async () => {
        const timestamp = Date.now();
        branchName = `feature/failing-ci-${timestamp}`;
        const codeFile = "failing-code.js";
        const brokenCode = "console.log('fail';\n";
        const failingTestJobStanza = `
test:
  stage: test
  image: node:18
  rules:
    - if: $CI_PIPELINE_SOURCE == "push" || $CI_PIPELINE_SOURCE == "merge_request_event"
      when: on_success
    - when: never
  script:
    - node ${codeFile}
`;

        console.log(`Creating branch: ${branchName}`);
        await createBranch(projectId, branchName, defaultBranch);
        await createRepositoryFile(projectId, codeFile, branchName, brokenCode, "Add broken code");

        const currentCi = await getRepositoryFile(projectId, ".gitlab-ci.yml", branchName);
        const ciWithTestStage = currentCi.replace(
            /(stages:\s*\n(?:\s*-\s*\w+\s*\n)*?)(\s*-\s*cleanup\s*\n)/m,
            "$1  - test\n$2"
        );
        await updateRepositoryFile(
            projectId,
            ".gitlab-ci.yml",
            branchName,
            ciWithTestStage + failingTestJobStanza,
            "Add failing test job to CI"
        );
        console.log("Appended failing test job to .gitlab-ci.yml on the feature branch.");

        const mrTitle = `Trigger failing CI ${timestamp}`;
        const mr = await createMergeRequest(projectId, branchName, defaultBranch, mrTitle, '') as any;
        mrIid = mr.iid;
        console.log(`MR created: #${mrIid} ${mr.web_url}`);

        console.log("Waiting for the MR's pipeline to fail...");
        const failedPipeline = await waitForFailedPipeline(projectId, mrIid!);
        console.log(`Found failed pipeline: #${failedPipeline!.id}`);

        const commentBody = `#junie fix-ci`;
        console.log(`Commenting on MR #${mrIid}: "${commentBody}"`);
        await addMergeRequestNote(projectId, mrIid!, commentBody);

        console.log("Waiting for Junie's started comment on MR...");
        await waitForMRComment(projectId, mrIid!, JUNIE_STARTED_MESSAGE);
        console.log("Junie started processing.");

        console.log("Waiting for Junie's finished comment on MR...");
        await waitForMRComment(projectId, mrIid!, JUNIE_FINISHED_PREFIX);
        console.log("Junie posted the finish message.");

        console.log("Verifying the broken code is no longer in the MR diff...");
        await waitForMRFileNotContains(projectId, mrIid!, codeFile, "console.log('fail';");
        console.log("Junie fix detected in MR diff.");
        testPassed = true;
    });
});
