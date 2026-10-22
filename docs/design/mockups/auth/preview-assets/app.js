const result = document.querySelector('#result');
fetch('./data.json').then((response) => {
  if (!response.ok) throw new Error(`Cannot read project result: ${response.status}`);
  return response.json();
}).then((data) => {
  document.querySelector('#completed').textContent = data.completed;
  result.textContent = data.summary;
  document.querySelector('#update').addEventListener('click', () => { result.textContent = `${data.completed} / ${data.total} 个任务已交付，团队正在持续推进。`; });
}).catch((error) => {
  result.textContent = '无法读取成果数据，请重新打开预览。';
  throw error;
});
