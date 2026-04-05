/**
 * Integration tests for the sign action's run() flow.
 * Since run() executes at import time, we use jest.isolateModulesAsync.
 */
declare let mockInputs: Record<string, string>;
declare let mockMultilineInputs: Record<string, string[]>;
declare let mockOutputs: Record<string, string>;
declare let mockFailed: string[];
declare let mockWarnings: string[];
declare let mockGlobFiles: string[];
declare let mockExecExitCode: number;
declare let mockExecOutputResult: {
    exitCode: number;
    stdout: string;
    stderr: string;
};
declare const mockResolveCredentials: jest.Mock<any, any, any>;
declare const mockCleanupPaths: jest.Mock<any, any, any>;
declare function resetMockState(): void;
declare function runMain(): Promise<void>;
