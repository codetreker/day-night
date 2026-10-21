let completed = 2;
document.getElementById('add').addEventListener('click', () => {
  completed += 1;
  document.getElementById('result').textContent = `已完成 ${completed} 个任务`;
});
fetch('data.json').then((response) => {
  if (!response.ok) throw new Error('Attachment fixture JSON request failed.');
  return response.json();
}).then((data) => {
  document.getElementById('data').textContent = `${data.title} · ${data.status}`;
});
