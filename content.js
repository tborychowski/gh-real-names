/*global chrome */

const REAL_NAME_CLS = 'gh-real-names-replaced';

const elementSelectors = [
	'.repository-content .author',
	'.assignee>span',
	'a[data-hovercard-type="user"]>span',
	'a[data-hovercard-type="user"]',
	'.user-mention',
	'.commit-author',
	'.js-project-issue-details-container>small>a.text-gray-dark', // project card
	'.js-comment-edit-history details summary>div>span',	// edited by... on a comment
	'.js-comment-edit-history-menu ul li button span.text-bold',	// dropdown for the above
	'.repository-content .col-md-3 .list-style-none a strong',	// "contributors" on repo home
	'.js-merge-review-section .review-status-item strong',	// "contributors" on repo home
	'tool-tip[for^="reactions"]',	// reaction emoji tooltip
];

const tooltippedSelectors = [
	'.AvatarStack-body.tooltipped',       // aria-label="Assigned to 123"
	'.reaction-summary-item.tooltipped',  // aria-label="123 reacted with..." || 123 and 234 reacted with thumbs up emoji
];

const trim = (str, chars = '\\s') => str.replace(new RegExp(`(^${chars}+)|(${chars}+$)`, 'g'), '');
const cleanupHovercard = str => str.replace('/users/', '').replace('/hovercard', '');
// @ts-ignore
const readFromCache = async () => new Promise(resolve => chrome.storage.local.get(['users'], res => resolve(res.users)));
// @ts-ignore
const saveToCache = async (users) =>new Promise(resolve => chrome.storage.local.set({ users: users }, () => resolve(0)));

function cleanupString (str) {
	return trim(str, '@')
		.replace('edited by ', '')
		.replace('edited', '')
		.replace(/reacted with ([a-z ])+ emoji/i, '')
		.trim();
}


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
function getElementsWithUserId () {
	const selectors = elementSelectors.map(s => s + `:not(.${REAL_NAME_CLS})`).join(',');
	return Array.from(document.querySelectorAll(selectors));
}

function getIdsFromElements (elems) {
	const ids = [];
	elems.forEach(el => {
		if (el.dataset && el.dataset.hovercardUrl) {
			ids.push(cleanupHovercard(el.dataset.hovercardUrl));
		}
		else if (el.tagName === 'A') {
			ids.push(el.getAttribute('href').substring(1));
		}
		else {
			const str = cleanupString(el.innerText);
			if (str.includes('and ') || str.includes(',')) {
				const strids = str.split(/and|,/g).map(i => i.trim()).filter(i => !!i);
				ids.push(...strids);
			}
			else ids.push(str);
		}
	});
	return [...new Set(ids.filter(id => !!id))];
}

function replaceIdsInElements (elems, users) {
	elems.forEach(el => {
		let txt = el.innerText;
		if (!txt) return;
		for (let [id, name] of Object.entries(users)) {
			if (txt.includes(id)) txt = txt.replace(id, name);
			el.title = id;
		}
		el.innerText = txt;
		el.style.maxWidth = 'unset';
		el.classList.add(REAL_NAME_CLS);
	});
}
//*** User IDs in Elements *************************************************************************



//*** User IDs in Tooltips *************************************************************************
function getTooltippedElementsWithUserId () {
	const selectors = tooltippedSelectors.map(s => s + `:not(.${REAL_NAME_CLS})`).join(',');
	return Array.from(document.querySelectorAll(selectors));
}

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
	// @ts-ignore
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






async function _run () {
	const elems = getElementsWithUserId();
	const tooltips = getTooltippedElementsWithUserId();
	const specialCases =  getSpecialCases();

	const idsFromElements = getIdsFromElements(elems);
	const idsFromTooltips = getIdFromTooltip(tooltips);
	// @ts-ignore
	const idsFromSpecialCases = specialCases.map(el => el.innerText.trim());

	const ids = [ ...new Set([ ...idsFromElements, ...idsFromTooltips, ...idsFromSpecialCases ]) ];
	const users = await fetchNames(ids);
	replaceIdsInElements(elems, users);
	replaceIdsInTooltips(tooltips, users);
	replaceIdsInSpecialCases(specialCases, users);
}

let timer;
function run () {
	clearTimeout(timer);
	timer = setTimeout(_run, 300);
}


function startObserving () {
	const targetNode = document.body;
	const observer = new MutationObserver(() => requestAnimationFrame(run));
	if (targetNode instanceof Node) {
		observer.observe(targetNode, { attributes: true, childList: true, subtree: true });
	}
}


function onUrlChange () {
	window.onpopstate = () => setTimeout(run, 500);
}


function init () {
	if (!location.hostname.includes('github')) return;
	startObserving();
	onUrlChange();
	requestAnimationFrame(run);
}

init();
