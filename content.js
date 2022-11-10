/*global chrome */

const REAL_NAME_CLS = 'gh-real-names-replaced';

const elementSelectors = [
	`.repository-content .author:not(.${REAL_NAME_CLS})`,
	`.assignee>span:not(.${REAL_NAME_CLS})`,
	`a[data-hovercard-type="user"]>span:not(.${REAL_NAME_CLS})`,
	`.user-mention:not(.${REAL_NAME_CLS})`,
	`.commit-author:not(.${REAL_NAME_CLS})`,
	`a[data-hovercard-type="user"]:not(.${REAL_NAME_CLS})`,
	`.js-project-issue-details-container>small>a.text-gray-dark:not(.${REAL_NAME_CLS})`, // project card
	`.js-comment-edit-history details summary>div>span:not(.${REAL_NAME_CLS})`,	// edited by... on a comment
	`.js-comment-edit-history-menu ul li button span.text-bold:not(.${REAL_NAME_CLS})`,	// dropdown for the above
	`.repository-content .col-md-3 .list-style-none a strong:not(.${REAL_NAME_CLS})`,	// "contributors" on repo home
];

const tooltippedSelectors = [
	`.AvatarStack-body.tooltipped:not(.${REAL_NAME_CLS})`,       // aria-label="Assigned to 123"
	`.reaction-summary-item.tooltipped:not(.${REAL_NAME_CLS})`,  // aria-label="123 reacted with..." || 123 and 234 reacted with thumbs up emoji
];

const trim = (str, chars = '\\s') => str.replace(new RegExp(`(^${chars}+)|(${chars}+$)`, 'g'), '');
const cleanupString = str => trim(str, '@').replace('edited by ', '').replace('edited', '').trim();
const readFromCache = async () => new Promise(resolve => chrome.storage.local.get(['users'], res => resolve(res.users)));
const saveToCache = async (users) =>new Promise(resolve => chrome.storage.local.set({ users: users }, () => resolve()));

function getNameFromId (id) {
	return fetch(`https://${window.location.hostname}/${id}`, { method: 'GET', cache: 'force-cache' })
		.then(res => res.text())
		.then(res => {
			const reg = new RegExp(`<title>${id} \\((.*)\\).*<\\/title>`, 'ig');
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
		if (users && users.length) {
			users.forEach(u => {
				if (u && u.id !== u.name) map[u.id] = u.name;
			});
		}
		if (Object.keys(map).length) saveToCache(map);
		return map;
	});
}


//*** User IDs in Elements *************************************************************************
const getElementsWithUserId = () => Array.from(document.querySelectorAll(elementSelectors.join(',')));

function getIdsFromElements (elems) {
	return elems
		.map(el => {
			if (el.tagName === 'A') return el.getAttribute('href').substring(1);
			return cleanupString(el.innerText);
		})
		.filter(id => !!id);
}

function replaceIdsInElements (elems, users) {
	elems.forEach(el => {
		const id = cleanupString(el.innerText);
		if (id && users[id]) {
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
			.replace(/Assigned to /gi, '');

		if (label.includes('and ') || label.includes(',')) {
			const lblids = label.split(/and|,/g).map(i => i.trim()).filter(i => !!i);
			ids.push(...lblids);
		}
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

	const idsFromElements = getIdsFromElements(elems);
	const idsFromTooltips = getIdFromTooltip(tooltips);
	const idsFromSpecialCases = specialCases.map(el => el.innerText.trim());

	const ids = [ ...new Set([ ...idsFromElements, ...idsFromTooltips, ...idsFromSpecialCases ]) ];
	const users = await fetchNames(ids);
	replaceIdsInElements(elems, users);
	replaceIdsInTooltips(tooltips, users);
	replaceIdsInSpecialCases(specialCases, users);
}


function startObserving (times = 0) {
	const targetNode = document.querySelector('#js-repo-pjax-container, .repository-content, .application-main');
	// delay 300ms & check again (up to 5 times)
	if (!targetNode && times < 5) return setTimeout(() => startObserving(++times), 300);
	const observer = new MutationObserver(() => requestAnimationFrame(run));
	if (targetNode instanceof Node) {
		observer.observe(targetNode, { attributes: false, childList: true, subtree: true });
	}
}


function init () {
	if (!location.hostname.includes('github')) return;
	startObserving();
	requestAnimationFrame(run);
}

init();
