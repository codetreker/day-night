import type { PlatformMessages } from "../platform";

export const platform: PlatformMessages = {
  title: "Execution platform", any: "Any platform", names: { windows: "Windows", linux: "Linux", macos: "macOS" },
  confirmTitle: "Change execution platform?", confirmQuestion: "Change the execution platform for this task?",
  transition: ({ from, to }) => `Current platform: ${from}. New platform: ${to}.`,
  explanation: "The task requirement changes only after confirmation. Workers must run on the required platform; Any platform removes the requirement.",
  confirm: "Change platform", cancel: "Cancel", closeConfirmation: "Close confirmation",
  help: "Workers must run on the required platform. Any platform removes the requirement. Select an option to review and confirm the change.",
  locked: "This task is already claimed. The execution platform is locked until execution ends or is released.",
  pending: "Saving the execution platform. You can close these details while the request completes.",
  confirmed: "Execution platform updated.",
  conflict: "The task changed. Review its current platform before confirming another change.",
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
