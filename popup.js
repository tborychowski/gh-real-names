// @ts-nocheck
/*global chrome */

const clearCache = async () => new Promise(resolve => chrome.storage.local.set({ users: {} }, () => resolve(0)));


document.getElementById('clearCache').addEventListener('click', async () => {
	const button = document.getElementById('clearCache');
	const status = document.getElementById('status');

	button.disabled = true;
	button.textContent = 'Clearing...';

	try {
		await clearCache();
		status.textContent = '✓ Cache cleared';
		status.classList.add('success');
		button.textContent = 'Clear Cache';

		setTimeout(() => {
			status.textContent = '';
			status.classList.remove('success');
		}, 2000);
	}
	catch (error) {
		status.textContent = '✗ Error clearing cache';
		button.textContent = 'Clear Cache';
	}
	finally {
		button.disabled = false;
	}
});
