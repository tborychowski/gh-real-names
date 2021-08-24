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
const readFromCache = async () => new Promise(resolve => chrome.storage.local.get(['users'], res => resolve(res.users)));
const saveToCache = async (users) =>new Promise(resolve => chrome.storage.local.set({ users: users }, () => resolve()));

function getNameFromId (id) {
	return fetch(`https://${window.location.hostname}/${id}`, { method: 'GET', cache: 'force-cache' })
		.then(res => res.text())
		.then(res => {
			const reg = new RegExp(`<title>${id} \\((.*)\\).*<\\/title>`, 'g');
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
		if (users && users.length) users.forEach(u => u ? map[u.id] = u.name : '');
		if (Object.keys(map).length) saveToCache(map);
		return map;
	});
}


//*** User IDs in Elements *************************************************************************
const getElementsWithUserId = () => Array.from(document.querySelectorAll(elementSelectors.join(',')));

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
//*** User IDs in Elements *************************************************************************



//*** User IDs in Tooltips *************************************************************************
const getTooltippedElementsWithUserId = () => Array.from(document.querySelectorAll(tooltippedSelectors.join(',')));

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
//*** User IDs in Tooltips *************************************************************************



//*** User IDs in Other elements *******************************************************************
function getSpecialCases () {
	const els = [];
	// 123 requested your review...
	const flash = document.querySelector('.flash-warn');
	if (flash && flash.innerText.includes('requested your review')) {
		const el = flash.querySelector(`.text-emphasized:not(.${REAL_NAME_CLS})`);
		if (el) els.push(el);
	}
	return els;
}

function replaceIdsInSpecialCases (elems, users) {
	elems.forEach(el => {
		const id = trim(el.innerText.trim(), '@');
		if (users[id]) {
			el.innerText = el.innerText.replace(id, users[id]);
			el.title = id;
			el.classList.add(REAL_NAME_CLS);
		}
	});
}
//*** User IDs in Other elements *******************************************************************






async function run () {
	const elems = getElementsWithUserId();
	const tooltips = getTooltippedElementsWithUserId();
	const specialCases =  getSpecialCases();

	const idsFromElements = elems.map(el => trim(el.innerText, '@'));
	const idsFromTooltips = getIdFromTooltip(tooltips);
	const idsFromSpecialCases = specialCases.map(el => el.innerText.trim());

	const ids = [ ...new Set([ ...idsFromElements, ...idsFromTooltips, ...idsFromSpecialCases ]) ];
	const users = await fetchNames(ids);
	replaceIdsInElements(elems, users);
	replaceIdsInTooltips(tooltips, users);
	replaceIdsInSpecialCases(specialCases, users);
}


function startObserving () {
	const targetNode = document.getElementById('js-repo-pjax-container');
	const observer = new MutationObserver(() => {
		requestAnimationFrame(run);
	});
	observer.observe(targetNode, { attributes: false, childList: true, subtree: true });
}


function init () {
	if (!location.hostname.includes('github')) return;
	startObserving();
	requestAnimationFrame(run);
}

setTimeout(init, 300);
