declare module "read-cmd-shim" {
  const readCmdShim: (filename: string) => Promise<string>;
  export default readCmdShim;
}
