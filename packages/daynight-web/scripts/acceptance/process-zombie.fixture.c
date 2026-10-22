#include <errno.h>
#include <libproc.h>
#include <signal.h>
#include <stdio.h>
#include <sys/wait.h>
#include <unistd.h>

/* Keep only our own exited child waitable until the test closes stdin. */
int main(void) {
  alarm(15);
  pid_t child = fork();
  if (child < 0) return 1;
  if (child == 0) _exit(0);
  siginfo_t status;
  if (waitid(P_PID, (id_t)child, &status, WEXITED | WNOWAIT) == -1) return 2;
  struct proc_bsdinfo info;
  errno = 0;
  int count = proc_pidinfo(child, PROC_PIDTBSDINFO, 0, &info, sizeof(info));
  int inspection_error = errno;
  int signal_result = kill(child, 0);
  printf("{\"pid\":%d,\"inspectionCount\":%d,\"inspectionError\":%d,\"signalResult\":%d}\n",
    child, count, inspection_error, signal_result);
  fflush(stdout);
  while (getchar() != EOF) {}
  return waitpid(child, NULL, 0) == child ? 0 : 3;
}
