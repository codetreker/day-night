let completed = 2;
document.getElementById('add').addEventListener('click', () => {
  completed += 1;
  document.getElementById('result').textContent = `已完成 ${completed} 个任务`;
});
