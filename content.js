/*global chrome */

const REAL_NAME_CLS = 'real-name-replaced';

const elementSelectors = [
	`.repository-content .author:not(.${REAL_NAME_CLS})`,
	`.assignee>span:not(.${REAL_NAME_CLS})`,
	`a[data-hovercard-type="user"]>span:not(.${REAL_NAME_CLS})`,
	`.user-mention:not(.${REAL_NAME_CLS})`,
];

const tooltippedSelectors = [
	`.AvatarStack-body.tooltipped:not(.${REAL_NAME_CLS})`,       // aria-label="Assigned to 123"
	`.reaction-summary-item.tooltipped:not(.${REAL_NAME_CLS})`,  // aria-label="123 reacted with..." || 123 and 234 reacted with thumbs up emoji
];
const trim = (str, chars = '\\s') => str.replace(new RegExp(`(^${chars}+)|(${chars}+$)`, 'g'), '');
const getElementsWithUserId = () => Array.from(document.querySelectorAll(elementSelectors.join(',')));
const getTooltippedElementsWithUserId = () => Array.from(document.querySelectorAll(tooltippedSelectors.join(',')));
const readFromCache = async () => new Promise(resolve => chrome.storage.local.get(['users'], res => resolve(res.users)));
const saveToCache = async (users) =>new Promise(resolve => chrome.storage.local.set({ users: users }, () => resolve()));

function getNameFromId (id) {
	return fetch(`https://${window.location.hostname}/${id}`, { method: 'GET', cache: 'force-cache' })
		.then(res => res.text())
		.then(res => {
			const reg = new RegExp(`<title>${id} \\((.*)\\)<\\/title>`, 'g');
			const match = reg.exec(res);
			if (match) return { id, name: match[1] };
		})
		.catch(() => console.error(`Could not get user ${id}`));
}

async function fetchNames (ids) {
	const cached = await readFromCache();
	const promises = ids.map(id => {
		if (!cached || !cached[id]) return getNameFromId(id);
		return Promise.resolve({ id, name: cached[id] });
	});
	return Promise.all(promises).then(users => {
		const map = {};
		users.forEach(({ id, name }) => map[id] = name);
		saveToCache(map);
		return map;
	});
}

function replaceIdsInElements (elems, users) {
	elems.forEach(el => {
		const id = trim(el.innerText, '@');
		if (users[id]) {
			el.innerText = el.innerText.replace(id, users[id]);
			el.title = id;
			el.classList.add(REAL_NAME_CLS);
		}
	});
}

function replaceIdsInTooltips (elems, users) {
	elems.forEach(el => {
		let label = el.getAttribute('aria-label');
		for (let [id, name] of Object.entries(users)) {
			if (label.includes(id)) label = label.replace(id, name);
		}
		el.setAttribute('aria-label', label);
		el.classList.add(REAL_NAME_CLS);
	});
}

function getIdFromTooltip (elems) {
	const ids = [];
	elems.forEach(el => {
		let label = el.getAttribute('aria-label')
			.replace(/ reacted with [\w\s]+ emoji/gi, '')
			.replace(/Assigned to /gi, '$2');

		if (label.includes(' and ')) ids.push(...label.split(' and '));
		else ids.push(label);
	});
	return ids;
}

async function init () {
	if (!location.hostname.includes('github')) return;
	const elems = getElementsWithUserId();
	const tooltips = getTooltippedElementsWithUserId();
	const idsFromElements = elems.map(el => trim(el.innerText, '@'));
	const idsFromTooltips = getIdFromTooltip(tooltips);
	const ids = [ ...new Set([ ...idsFromElements, ...idsFromTooltips ]) ];
	const users = await fetchNames(ids);
	replaceIdsInElements(elems, users);
	replaceIdsInTooltips(tooltips, users);
}
setTimeout(init, 300);
