// @ts-nocheck
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
const readFromCache = async () => new Promise(resolve => chrome.storage.local.get(['users'], res => resolve(res.users)));
const saveToCache = async (users) => new Promise(resolve => chrome.storage.local.set({ users: users }, () => resolve(0)));

function cleanupString (str) {
	return trim(str, '@')
		.replace('edited by ', '')
		.replace('edited', '')
		.replace(/reacted with ([a-z ])+ emoji/i, '')
		.trim();
}

function parseUserPageTitle (res, id) {
	let name = '';
	let match = new RegExp(`<title>${id}( \\((.*)\\))?.*<\\/title>`, 'ig').exec(res);
	if (match && match.at(2)) name = match.at(2);
	else if (match && match[0]) name = match[0].replace('<title>', '').replace('</title>', '');
	else name = id;
	return name.replace(/github/ig, '').replace(/·/ig, '').trim();
}

// handle code 429 - Too Many Requests
// handle code 404 - user not found (maybe deleted account?)
let reqLimit = false;
const REQ_LIMIT_TIMEOUT = 1000 * 30;
function getNameFromId (id) {
	if (reqLimit) return Promise.resolve(null);

	return fetch(`https://${window.location.hostname}/${id}`, { method: 'GET', cache: 'force-cache' })
		.then(res => {
			if (res.status === 429) {
				reqLimit = true;
				setTimeout(() => reqLimit = false, REQ_LIMIT_TIMEOUT);
				console.warn('GitHub is rate limiting requests, caching results and trying again later');
				return null;
			}
			if (res.status === 404) return { id, name: id };
			if (!res.ok) throw new Error();
			return res.text();
		})
		.then(res => {
			if (res.id && res.name) return res;
			const name = parseUserPageTitle(res, id);
			if (name) return { id, name };
		})
		.catch(() => console.warn(`Could not get user ${id}`));
}

async function fetchNames (ids) {
	const cached = await readFromCache();
	const promises = ids.map(id => {
		if (!cached || !cached[id]) return getNameFromId(id);
		return Promise.resolve({ id, name: cached[id] });
	});
	return Promise.all(promises).then(users => {
		const map = {};
		if (Array.isArray(users)) {
			users
				.filter(u => !!u)
				.forEach(u => {
					if (u) map[u.id] = u.name;
				});
		}
		if (!Object.keys(map).length) return map;
		const all = { ...cached, ...map };
		return saveToCache(all).then(() => all);
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



//*** User IDs are in random-selector-elements *****************************************************
const MAX_LEVELS_UP = 4;
function findParentWithText (node, levels = 0) {
	if (!node) return null;
	if (levels > MAX_LEVELS_UP) return null;
	// don't check for these - they have already been handled by regular selectors
	if (node.matches('a[data-hovercard-type="user"]')) return null;
	if (node.matches('body')) return node;
	return node.innerText ? node : findParentWithText(node.parentElement, levels + 1);
}

const isId = (txt) => ('' + txt).replace(/[^a-z0-9]/gi, '').length > 2;

function findTextElements (root) {
	const result = [], stack = [root];
	while (stack.length) {
		const node = stack.pop();
		if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
		const children = node.children;
		if (children.length === 0) {
			const text = node.textContent?.trim() ?? '';
			if (text.length > 0) result.push(node);
			continue;
		}
		for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
	}
	return result;
}

function getRandomisedSelectors () {
	const avatars = document.querySelectorAll('[data-testid="github-avatar"]');
	const els = [];
	avatars.forEach(a => {
		const parent = findParentWithText(a);
		const textNodes = findTextElements(parent).filter(n => isId(n.innerText));
		els.push(...textNodes);
	});
	return els.filter(el => !el.classList.contains(REAL_NAME_CLS));
}
//*** User IDs are in random-selector-elements *****************************************************






async function _run () {
	const elems = getElementsWithUserId();
	const tooltips = getTooltippedElementsWithUserId();
	const specialCases =  getSpecialCases();
	const randomisedSelectors =  getRandomisedSelectors();

	const idsFromElements = getIdsFromElements(elems);
	const idsFromTooltips = getIdFromTooltip(tooltips);
	const idsFromSpecialCases = specialCases.map(el => el.innerText.trim());
	const idsFromRandomised = getIdsFromElements(randomisedSelectors);

	const ids = [...new Set([...idsFromElements, ...idsFromTooltips, ...idsFromSpecialCases, ...idsFromRandomised])];

	const users = await fetchNames(ids);

	replaceIdsInElements(elems, users);
	replaceIdsInTooltips(tooltips, users);
	replaceIdsInSpecialCases(specialCases, users);
	replaceIdsInElements(randomisedSelectors, users);
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
