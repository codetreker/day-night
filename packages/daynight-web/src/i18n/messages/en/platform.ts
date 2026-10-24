import type { PlatformMessages } from "../platform";

export const platform: PlatformMessages = {
  title: "Execution platform", any: "Any platform", names: { windows: "Windows", linux: "Linux", macos: "macOS" },
  save: "Save platform",
  help: "Workers must run on the required platform. Any platform removes the requirement. Select an option, then save it.",
  locked: "This task is in progress. The execution platform cannot change while it remains in progress.",
  pending: "Saving the execution platform. You can close these details while the request completes.",
  confirmed: "Execution platform updated.",
  conflict: "The task changed. Review its current platform before saving another change.",
  unknown: "The platform update outcome is unconfirmed. Check the actual task before another operation.",
  reconciled: "The actual task has been read. The displayed platform is confirmed.",
  checking: "Checking the actual task…", checkState: "Check actual task",
  checkFailed: "The actual task could not be confirmed. Changes remain unavailable until it can be read.",
  networkError: "The platform update did not reach a confirmed response from the service.",
  protocolError: "The service response could not confirm the execution platform.",
  versionConflict: "The task version changed before this update could be applied.",
  invalidTransition: "The execution platform cannot be changed while this task is in progress.",
  notFound: "The task or project is no longer available.",
  refused: "The service refused the execution platform change.", requestFailed: "The execution platform change failed.",
};
