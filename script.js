// ==UserScript==
// @name         HH.ru Auto Responder  v2.1.0
// @namespace    http://tampermonkey.net/
// @version      v2.1.0
// @description  Авто-отклики на hh.ru
// @author       Timur Geruzov (modified)
// @match        *://*.hh.ru/search/vacancy*
// @match        *://*.hh.ru/vacancy/*
// @match        *://*.hh.ru/applicant/vacancy_response*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=hh.ru
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_PREFIX = 'hh_ar_v2_';                                                                                         // Настройки хранилищ и ключи для local/session storage
    const KEYS           = {
                               settings         : STORAGE_PREFIX + 'cfg_data',
                               isRunning        : STORAGE_PREFIX + 'is_active',
                               returnUrl        : STORAGE_PREFIX + 'list_url',
                               history          : STORAGE_PREFIX + 'processed_ids',
                               needF5           : STORAGE_PREFIX + 'reload_flag',
                               trapLock         : STORAGE_PREFIX + 'ar_trap_lock',
                               instanceLock     : STORAGE_PREFIX + 'instance_lock',
                               lastAttempt      : STORAGE_PREFIX + 'last_attempt_id',
                               lastTitle        : STORAGE_PREFIX + 'last_title',                                                // Название текущей вакансии
                               lastFio          : STORAGE_PREFIX + 'last_fio',                                                  // ФИО контактного лица
                               state            : STORAGE_PREFIX + 'state',
                               manualList       : STORAGE_PREFIX + 'manual_list',
                               sessionCount     : STORAGE_PREFIX + 'session_count'
                           },
    SELECTORS            = {                                                                                                    // Важные селекторы, используемые в скрипте
                               applyBtn         : '[data-qa="vacancy-serp__vacancy_response"], button[data-qa="vacancy-serp__vacancy_response"]',
                               topApply         : '[data-qa="vacancy-response-link-top"], a[data-qa="vacancy-response-link-top"]',
                               coverToggle      : '[data-qa="add-cover-letter"], [data-qa="vacancy-response-letter-toggle"]',        // Объединенный селектор для модалки и страницы вопросов
                               modalTextarea    : 'textarea[data-qa="vacancy-response-popup-form-letter-input"], textarea[name="coverLetter"]',
                               modalSubmit      : '[data-qa="vacancy-response-submit-popup"], button[data-qa="vacancy-response-submit-popup"]',
                               nativeWrapper    : '[data-qa="textarea-native-wrapper"]',
                               relocationBtn    : '[data-qa="relocation-warning-confirm"]',
                               vacancyLink      : 'a[data-qa="serp-item__title"], a[data-qa="vacancy-serp__vacancy-title"]',
                               vacancyCard      : 'div[data-qa="vacancy-serp__vacancy"], .vacancy-serp-item',
                               resumeDropdown   : '[data-qa="resume-title"]',
                               resumeItemBase   : '[data-qa="magritte-select-option-{ID}"]',
                               vacancyTitle     : '[data-qa="vacancy-title"]',                                                  // Селектор названия вакансии
                               contactsBtn      : '[data-qa="show-employer-contacts show-employer-contacts_top-button"]',        // Кнопка "Показать контакты"
                               contactsFio      : '[data-qa="vacancy-contacts__fio"]'                                           // ФИО в блоке контактов
                           },
    DEFAULTS_FIXED       = {                                                                                                    // Параметры, которые каждый раз загружаются заново
                               templates        : [
                                                     { value: 'Добрый день{lastRecruiterName}! Ознакомился с вакансией{lastTitle}. Мой опыт релевантен вашим задачам, буду рад обсудить подробности на интервью.' },
                                                     { value: 'Здравствуйте! Заинтересовала вакансия {lastTitle}. Имею коммерческий опыт работы с вашим стеком технологий. Подробности в резюме.' },
                                                     { value: 'Добрый день! Прошу рассмотреть мою кандидатуру на позицию{lastTitle}. Буду рад обратной связи!' },
                                                     { value: 'Добрый день! Имею коммерческий опыт вфывыфвф' }
                                                  ],
                               resumes          : [
                                                     { name: 'Не выбирать (текущее)', value: '' },
                                                     { name: 'SQL-Разработчик',       value: '510669b0ff0ff5b8810039ed1f5945306a6863' },
                                                     { name: 'Разработчик SQL',       value: '8c5823a8ff0997221f0039ed1f7250444b726c' }
                                                  ]
                           },
    DEFAULTS             = {                                                                                                    // Параметры, которые загружатся лишь в первый раз, а дальше изменяются
                               selectedTemplate : 0,
                               selectedResume   : 0,
                               useCover         : true,
                               delayMin         : 2000,
                               delayMax         : 5000,
                               limit            : 50,
                               skipHidden       : true,
                               viewMin          : 8000,
                               viewMax          : 25000,
                               scrollStepMs     : 200,
                               actionDelayMin   : 150,
                               actionDelayMax   : 700,
                               waitForModalMs   : 8000,
                               instanceLockTtl  : 30000
                           };

    const StateManager   = {                                                                                                    // Небольшой менеджер состояния — работа с local/session storage
        loadConfig         : ()      => {
                                           try          { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEYS.settings) || '{}'), ...DEFAULTS_FIXED }; }
                                           catch        { return { ...DEFAULTS,                                                             ...DEFAULTS_FIXED }; }
                                        },
        saveConfig         : (s)     => localStorage.setItem(KEYS.settings, JSON.stringify(s)),
        getProcessedIDs    : ()      => {
                                           try          { return new Set(JSON.parse(sessionStorage.getItem(KEYS.history) || '[]')); }
                                           catch        { return new Set(); }
                                        },
        addProcessedID     : (id)    => {
                                           const s      = StateManager.getProcessedIDs();
                                           s.add(id);
                                           sessionStorage.setItem(KEYS.history, JSON.stringify([...s]));
                                        },
        clearProcessedIDs  : ()      => { 
                                           sessionStorage.removeItem(KEYS.history);
                                           sessionStorage.removeItem(KEYS.sessionCount);
                                        },
        getSessionCount    : ()      => parseInt(sessionStorage.getItem(KEYS.sessionCount) || '0', 10),
        incSessionCount    : ()      => {
                                           const current = StateManager.getSessionCount() + 1;
                                           sessionStorage.setItem(KEYS.sessionCount, current.toString());
                                           return current;
                                        },
        amIRunning         : ()      =>         sessionStorage.getItem   (KEYS.isRunning) === '1',
        setRunning         : (state) => state ? sessionStorage.setItem   (KEYS.isRunning, '1') : sessionStorage.removeItem(KEYS.isRunning),
        setReturnUrl       : (url)   =>         sessionStorage.setItem   (KEYS.returnUrl, url || location.href),
        getReturnUrl       : ()      =>         sessionStorage.getItem   (KEYS.returnUrl),
        setF5Needed        : ()      =>         sessionStorage.setItem   (KEYS.needF5, '1'),
        isF5Needed         : ()      =>         sessionStorage.getItem   (KEYS.needF5) === '1',
        clearF5Flag        : ()      =>         sessionStorage.removeItem(KEYS.needF5),
        setTrapLock        : ()      => {                                                                                              // "Ловушка" — пометка, что мы уже обрабатываем возврат с тестовой страницы
                                           sessionStorage.setItem(KEYS.trapLock, '1');
                                           setTimeout(()           => {                                                                                                  // авто-очистка через 15 сек, если что-то пошло не так
                                               if (sessionStorage.getItem(KEYS.trapLock) === '1') {
                                                   sessionStorage.removeItem(KEYS.trapLock);
                                                   log('Очистил ar_trap_lock по таймауту.');
                                               }
                                           }, 15000);
                                        },
        clearTrapLock      : ()      => sessionStorage.removeItem(KEYS.trapLock),
        hasTrapLock        : ()      => sessionStorage.getItem(KEYS.trapLock) === '1',
        setLastAttemptID   : (id)    => {                                                                                            // Запоминаем последнюю попытку отклика — пригодится при редиректах
                                           if (id)      sessionStorage.setItem(KEYS.lastAttempt, id);
                                        },
        getLastAttemptID   : ()      => sessionStorage.getItem(KEYS.lastAttempt),
        clearLastAttemptID : ()      => sessionStorage.removeItem(KEYS.lastAttempt),
        clearLastVacancyData: ()     => {                                                                                              // Очистка данных о текущей вакансии перед новым циклом
                                           sessionStorage.removeItem(KEYS.lastTitle);
                                           sessionStorage.removeItem(KEYS.lastFio);
                                        },
        acquireInstanceLock: (tabId) => {                                                                                        // Простая кросс-вкладочная блокировка (instance lock)
                                           try {
                                               const now = Date.now();
                                               const raw = localStorage.getItem(KEYS.instanceLock);
                                               if (raw) {
                                                   const obj = JSON.parse(raw);
                                                   if (now - obj.ts < config.instanceLockTtl && obj.tabId !== tabId) {
                                                       return false;
                                                   }
                                               }
                                               localStorage.setItem(KEYS.instanceLock, JSON.stringify({ tabId : tabId, ts : now }));
                                               return true;
                                           } catch (e)  { return true; }
                                        },
        releaseInstanceLock: (tabId) => {
                                           try {
                                               const raw = localStorage.getItem(KEYS.instanceLock);
                                               if (!raw) return;
                                               const obj = JSON.parse(raw);
                                               if (obj.tabId === tabId) localStorage.removeItem(KEYS.instanceLock);
                                           } catch (e)  { /* ignore */ }
                                        },
        touchInstanceLock  : (tabId) => {                                                                                         // Обновляем timestamp блокировки, чтобы другие вкладки видели, что мы живы
                                           try {
                                               const raw = localStorage.getItem(KEYS.instanceLock);
                                               if (!raw) return;
                                               const obj = JSON.parse(raw);
                                               if (obj.tabId === tabId) localStorage.setItem(KEYS.instanceLock, JSON.stringify({ tabId : tabId, ts : Date.now() }));
                                           } catch (e)  { /* ignore */ }
                                        },
        getManualList      : ()      => {                                                                                              // --- manual list (vacancies that require manual answering) ---
                                            try          { return JSON.parse(localStorage.getItem(KEYS.manualList) || '[]'); }
                                            catch        { return []; }
                                        },
        addManualEntry     : (entry) => {
                                            try {
                                                const list   = StateManager.getManualList();
                                                const exists = list.find(e => e.vid === entry.vid || e.url === entry.url);
                                                if (!exists) {
                                                    list.unshift(entry);
                                                    if (list.length > 500) list.length = 500;                                                                   // ограничим длину списка, чтобы не раздувался
                                                    localStorage.setItem(KEYS.manualList, JSON.stringify(list));
                                                }
                                            } catch (e)  { console.warn('addManualEntry error', e); }
                                        },
        removeManualEntry  : (vid)   => {
                                            try {
                                                const list = StateManager.getManualList().filter(e => e.vid !== vid);
                                                localStorage.setItem(KEYS.manualList, JSON.stringify(list));
                                            } catch (e)  { console.warn('removeManualEntry error', e); }
                                        },
        clearManualList    : ()      => localStorage.removeItem(KEYS.manualList)
    };

    let config           = StateManager.loadConfig();
    let isLoopActive     = false;
    let stopSignal       = false;
    const TAB_ID         = Math.random().toString(36).slice(2, 9);

    const hasInstance    = StateManager.acquireInstanceLock(TAB_ID);                                                            // Пытаемся поставить кросс-вкладочный lock — если не получилось, предупреждаем в консоли
    if (!hasInstance)    {
        console.warn('[HH-AR] Похоже, в другой вкладке уже запущен процесс. Продолжаю, но возможны дубликаты.');
    }

    const wait           = ms => new Promise(r => setTimeout(r, ms));                                                           // Утилиты
    const randomDelay    = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const actionPause    = async () => await wait(randomDelay(config.actionDelayMin, config.actionDelayMax));
    const clamp          = (v, a, b) => Math.max(a, Math.min(b, v));

    const log            = (msg, isError = false) => {                                                                          // Лог в панели + консоль
                               const timestamp  = new Date().toLocaleTimeString();
                               const entry      = document.createElement('div');
                               entry.textContent= `[${timestamp}] ${msg}`;
                               if (isError) entry.style.color = '#ff4d4f';
                               const logBox     = document.getElementById('ar-log-box');
                               if (logBox) {
                                   logBox.appendChild(entry);
                                   logBox.scrollTop = logBox.scrollHeight;
                               }
                               console.log(`[HH-AR] ${msg}`);
                           };

    function fillTextarea(el, value) {                                                                                          // Корректная вставка текста в textarea (учитывает React/Magritte)
        try {
            const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
            if (descriptor && descriptor.set) {
                 descriptor.set.call(el, value);
            } else {
                 el.value = value;
            }
            el.dispatchEvent(new Event('input', { bubbles : true }));
            const wrapper = el.closest(SELECTORS.nativeWrapper) || el.parentElement;                                            // Обновляем визуальный wrapper, если он есть
            const clone   = wrapper?.querySelector('pre');
            if (clone)   clone.textContent = value || '\u200B';
        } catch (e) { 
            console.warn('fillTextarea error', e); 
        }
    }

    async function waitForElement(selector, timeout = config.waitForModalMs) {                                                  // Ждём появления элемента — MutationObserver помогает при динамическом DOM
        const el         = document.querySelector(selector);
        if (el)          return el;
        return new Promise((resolve) => {
            const observer = new MutationObserver(() => {
                const found = document.querySelector(selector);
                if (found) {
                    observer.disconnect();
                    resolve(found);
                }
            });
            observer.observe(document.documentElement || document, { childList : true, subtree : true });
            setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    }

    async function humanScrollToCompanySectionAndReturn(viewTime) {                                                             // Человеческий скролл: вниз до 60% страницы, пауза, и возврат вверх
        try {
            await actionPause();

            const stepMs     = Math.max(100, config.scrollStepMs || DEFAULTS.scrollStepMs);
            const docHeight  = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
            const winH       = window.innerHeight || document.documentElement.clientHeight;
            const maxY       = Math.max(0, docHeight - winH);
            const needle     = 'подходящие вакансии в этой компании';
            let   sectionEl  = null;
            const candidates = Array.from(document.querySelectorAll('h1,h2,h3,h4,div,section'));
            for (const el of candidates) {
                try {
                    if (!el.innerText) continue;
                    if (el.innerText.trim().toLowerCase().includes(needle)) {
                        sectionEl = el;
                        break;
                    }
                } catch (e) { continue; }
            }

            let targetY      = null;
            if (sectionEl) {
                const rect   = sectionEl.getBoundingClientRect();
                targetY      = Math.max(0, Math.round(rect.top + window.pageYOffset - 100));
                if (targetY > maxY) targetY = maxY;
                log('Найдена секция "Подходящие вакансии..." — скроллю до неё.');
            } else {
                targetY      = Math.round(maxY * 0.6);
                log('Секция не найдена — скроллю до 60% страницы (фоллбек).');
            }

            const totalSteps = Math.max(6, Math.floor((viewTime / stepMs) / 2));
            const startY     = window.pageYOffset || 0;

            for (let i = 1; i <= totalSteps; i++) {
                if (stopSignal) return;
                const frac   = i / totalSteps;
                const y      = Math.round(startY + (targetY - startY) * frac);
                window.scrollTo({ top : y, behavior : 'auto' });
                await wait(stepMs + randomDelay(-Math.floor(stepMs/3), Math.floor(stepMs/3)));
                await actionPause();
            }

            await wait(randomDelay(800, 1600));
            await actionPause();

            const upSteps    = Math.max(4, Math.floor(totalSteps / 2));
            for (let i = upSteps; i >= 0; i--) {
                if (stopSignal) return;
                const frac   = i / upSteps;
                const y      = Math.round(startY + (targetY - startY) * frac);
                window.scrollTo({ top : y, behavior : 'auto' });
                await wait(stepMs + randomDelay(-Math.floor(stepMs/4), Math.floor(stepMs/4)));
                await actionPause();
            }

            window.scrollTo({ top : 0, behavior : 'auto' });
            await wait(200 + randomDelay(0, 500));
            await actionPause();
        } catch (e) {
            console.warn('humanScrollToCompanySectionAndReturn error', e);
        }
    }

    async function performResumeSelection() {                                                                                  // Универсальная логика выбора резюме
        try {
            const resumeConfig = config.resumes[config.selectedResume];
            if (!resumeConfig || !resumeConfig.value) return;

            const dropdown = document.querySelector(SELECTORS.resumeDropdown);
            if (dropdown) {
                dropdown.click();
                await actionPause();
                const itemSel = SELECTORS.resumeItemBase.replace('{ID}', resumeConfig.value);
                const opt = await waitForElement(itemSel, 2000);
                if (opt) {
                    opt.click();
                    log('Резюме выбрано.');
                    await actionPause();
                }
            }
        } catch (e) {
            console.warn('performResumeSelection error', e);
        }
    }

    async function performCoverLetterInsertion() {                                                                              // Универсальная логика вставки сопроводительного письма
        try {
            if (!config.useCover) return;

            const toggle = document.querySelector(SELECTORS.coverToggle);                                                       // Ищем кнопку добавления письма или переключатель
            if (toggle) {
                toggle.click();
                await actionPause();
            }

            const area = await waitForElement(SELECTORS.modalTextarea, 2000);
            if (area) {
                let   text              = config.templates[config.selectedTemplate].value;
                const lastTitle         = sessionStorage.getItem(KEYS.lastTitle) || '';
                const lastFio           = sessionStorage.getItem(KEYS.lastFio)   || '';
                
                const fioParts          = lastFio.trim().split(/\s+/);                                                          // Извлекаем имя (второе слово) для обращения
                const lastRecruiterName = fioParts.length >= 2 ? fioParts[1] : fioParts[0];

                text = text.replace(/{lastTitle}/g,         lastTitle         ? " "  + lastTitle         : "")  // Групповая замена плейсхолдеров
                           .replace(/{lastRecruiterName}/g, lastRecruiterName ? ", " + lastRecruiterName : "")
                           .replace(/{lastFio}/g,           lastFio           ? ", " + lastFio           : "");

                fillTextarea(area, text);
                log('Сопроводительное письмо вставлено.');
                await actionPause();
            }
        } catch (e) {
            console.warn('performCoverLetterInsertion error', e);
        }
    }

    async function fillResponsePageData() {                                                                                     // Наполнение страницы с вопросами данными
        log('Заполнение данных...');
        await actionPause();
        await performResumeSelection();
        await performCoverLetterInsertion();
    }

    function watchTheURL() {                                                                                                    // Watchdog: если попали на страницу с вопросами — пытаемся безопасно вернуться и помечаем вакансию
        setInterval(async () => {
            StateManager.touchInstanceLock(TAB_ID);                                                                             // Обновляем timestamp instance lock

            if (!StateManager.amIRunning()) return;

            if (location.href.includes('/applicant/vacancy_response')) {                                                        // Если оказались на странице вопросов/теста
                if (!StateManager.hasTrapLock()) {
                    StateManager.setTrapLock();
                    log('Попали на вопросы/тест. Инициирую возврат (попытка history.go(-2)).', true);

                    await fillResponsePageData();                                                                               // Сначала выбираем резюме и заполняем письмо на странице

                    let vid  = null;                                                                                            // Старательно пытаемся найти ID вакансии, чтобы пометить её как обработанную
                    try {
                        if (document.referrer) {
                            vid = getVacancyIDFromHref(document.referrer);
                            if (vid) vid = 'v_' + vid;
                        }
                    } catch (e) { /* ignore */ }

                    if (!vid) { const last = StateManager.getLastAttemptID();     if (last) vid = last; }
                    if (!vid) { const cur  = getVacancyIDFromHref(location.href); if (cur)  vid = 'v_' + cur; }

                    const savedBack = StateManager.getReturnUrl();

                    try {                                                                                                       // Сохраняем текущую страницу с вопросами для ручного отклика
                        const manualUrl = location.href;
                        const entry     = {
                            vid         : vid || ('u_' + fnv1a32(manualUrl).toString(36)),
                            url         : manualUrl,
                            returnUrl   : savedBack || '',
                            ts          : Date.now()
                        };
                        StateManager.addManualEntry(entry);
                        log(`Сохранена вакансия для ручного отклика: ${entry.vid}`);
                    } catch (e) { console.warn('save manual entry error', e); }

                    if (vid) {
                        StateManager.addProcessedID(vid);
                        log(`Пометил вакансию ${vid} как обработанную (чтобы избежать зацикливания).`);
                        StateManager.incSessionCount();                                                                         // Инкремент счетчика даже при попадании на вопросы
                        StateManager.clearLastAttemptID();
                    } else {
                        log('Не удалось определить ID вакансии на странице с вопросами.', true);
                    }

                    StateManager.setF5Needed();                                                                                 // после возвращения нужно обновить список
                    const backUrl = StateManager.getReturnUrl();

                    try {                                                                                                       // Пытаемся откатиться двумя шагами назад: list <- vacancy <- applicant
                        history.go(-2);
                    } catch (e) {
                        history.back();
                    }

                    setTimeout(() => {                                                                                          // Если через 1.2 сек всё ещё на странице с тестом — форсим переход по сохранённому URL
                        if (location.href.includes('/applicant/vacancy_response')) {
                            if (backUrl) {
                                log('Двухшаговый возврат не сработал. Перехожу по сохранённому URL.', true);
                                window.location.href = backUrl;
                            } else {
                                log('Двухшаговый возврат не сработал и returnUrl недоступен. Делаю history.back().', true);
                                history.back();
                            }
                        }
                    }, 1200);
                }
            }
            else if (document.querySelector(SELECTORS.applyBtn) || location.href.includes('/search/vacancy')) {                 // Если вернулись на список вакансий — снимаем ловушку и при необходимости обновляем страницу
                 StateManager.clearTrapLock();

                 if (StateManager.isF5Needed()) {
                     log('Возврат выполнен. Перезагружаю страницу, чтобы обновить список вакансий...');
                     StateManager.clearF5Flag();
                     window.location.reload();
                 }
            }
        }, 1000);
    }

    function getVacancyIDFromHref(href) {                                                                                       // Попытки извлечь ID вакансии из URL в разных форматах
        if (!href) return null;
        const m1 = href.match(/\/vacancy\/(\d+)/);    if (m1) return String(m1[1]);
        const m2 = href.match(/[?&]vacancyId=(\d+)/); if (m2) return String(m2[1]);
        const m3 = href.match(/vacancyId%3D(\d+)/);   if (m3) return String(m3[1]);
        return null;
    }

    function fnv1a32(str) {                                                                                                     // Простой стабильный хеш (FNV-1a 32) — запасной вариант
        let h            = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
            h >>>= 0;
        }
        return h >>> 0;
    }

    function getVacancyID(node) {                                                                                               // Получение уникального ID вакансии для отслеживания — сначала по ссылке, затем по хешу
        try {
            const card   = node.closest ? node.closest(SELECTORS.vacancyCard) : null;
            const link   = (card && card.querySelector) ? card.querySelector(SELECTORS.vacancyLink) : null;
            const href   = (link && link.href) || node.href || (node.getAttribute && node.getAttribute('href')) || '';
            const id     = getVacancyIDFromHref(href);
            if (id)      return 'v_' + id;
            let text     = '';
            if (card && card.innerText) text = card.innerText.slice(0, 300);
            if (!text && href) text = href;
            if (!text)   text = (document.title || '') + '|' + (card ? card.dataset?.id || '' : '');
            const h      = fnv1a32(text);
            return 'h_' + h.toString(36);
        } catch (e)      {
            return 'h_' + (Date.now()).toString(36);
        }
    }

    async function processVacancyOnListing(vacancyLinkEl, applyBtnOnList) {                                                     // Открываем вакансию с списка: запоминаем lastAttempt и переходим по ссылке
        const href       = vacancyLinkEl?.href || vacancyLinkEl.getAttribute('href');
        const vid        = getVacancyID(vacancyLinkEl || applyBtnOnList);

        await actionPause();
        StateManager.setReturnUrl();

        try              { vacancyLinkEl.scrollIntoView({ block : 'center', behavior : 'smooth' }); }
        catch (e)       { /* ignore */ }
        await actionPause();

        if (href) {
            log(`Открываю страницу вакансии ${vid} для чтения...`);
            await actionPause();
            StateManager.setLastAttemptID(vid);                                                                                 // запомним, на какую вакансию кликаем
            window.location.href = href;
            return 'NAVIGATED';
        } else {
            log('Не удалось получить href вакансии — пропускаю.', true);
            return 'ERROR_NO_HREF';
        }
    }

    async function processVacancy(btn) {                                                                                        // Обработка вакансии: работает и на странице вакансии, и для кнопки на листинге
        if (location.pathname.startsWith('/vacancy/')) {
            const vid    = getVacancyID(btn || document);
            StateManager.setReturnUrl(document.referrer || '/search/vacancy');

            StateManager.clearLastVacancyData();                                                                                // Обязательная очистка переменных перед извлечением новых данных
            
            const viewTime = randomDelay(config.viewMin, config.viewMax);
            log(`Читаю ~${Math.round(viewTime/1000)} сек (имитирую просмотр страницы).`);

            try {                                                                                                               // Сбор мета-информации о вакансии
                const titleEl = document.querySelector(SELECTORS.vacancyTitle);
                if (titleEl) {
                    const title = titleEl.innerText.trim();
                    sessionStorage.setItem(KEYS.lastTitle, title);
                    log(`Название: ${title}`);
                }

                const cBtn = document.querySelector(SELECTORS.contactsBtn);                                                     // Контакты извлекаются только если есть кнопка
                if (cBtn) {
                    cBtn.click();
                    await wait(800);                                                                                            // Пауза для отрисовки ФИО после клика
                    const fioEl = document.querySelector(SELECTORS.contactsFio);
                    if (fioEl) {
                        const fio = fioEl.innerText.trim();
                        sessionStorage.setItem(KEYS.lastFio, fio);
                        log(`Контакт: ${fio}`);
                    }
                }
            } catch (e) { /* ignore data errors */ }

            await humanScrollToCompanySectionAndReturn(viewTime);

            await actionPause();

            let applyBtn = document.querySelector(SELECTORS.topApply) || await waitForElement(SELECTORS.applyBtn, config.waitForModalMs);
            if (!applyBtn) {
                if (location.href.includes('/applicant/vacancy_response')) {                                            // Если нас уже редиректнуло на страницу с вопросами — помечаем вакансию и уходим
                    StateManager.addProcessedID(vid);
                    StateManager.incSessionCount();                                                                             // Инкремент счетчика при редиректе
                    StateManager.clearLastAttemptID();
                    return 'REDIRECT';
                }
                StateManager.addProcessedID(vid);                                                                       // Если кнопки нет — помечаем вакансию обработанной и возвращаемся к списку
                StateManager.clearLastAttemptID();
                StateManager.setF5Needed();
                log('Кнопка "Откликнуться" не найдена — помечаю вакансию как обработанную и возвращаюсь.', true);

                const backUrl = StateManager.getReturnUrl();
                if (backUrl && backUrl.includes('/search/vacancy')) {
                    try  { window.location.href = backUrl; }
                    catch(e){ try { history.back(); } catch (err) { /* ignore */ } }
                } else {
                    try  { history.back(); } catch (e) { /* ignore */ }
                }
                return 'NO_APPLY_RETURNED';
            }

            StateManager.setLastAttemptID(vid);                                                                                 // Пометим, что сейчас пытаемся откликнуться на эту вакансию

            window.scrollTo({ top : 0, behavior : 'auto' });
            await actionPause();

            const topBtn = document.querySelector(SELECTORS.topApply);
            if (topBtn)  {
                topBtn.scrollIntoView({ block : 'center', behavior : 'auto' });
                await actionPause();
                topBtn.click();
            } else {
                applyBtn.scrollIntoView({ block : 'center', behavior : 'auto' });
                await actionPause();
                applyBtn.click();
            }

            await actionPause();

            let submitButton = await waitForElement(SELECTORS.modalSubmit, config.waitForModalMs);
            if (!submitButton) {
                const relocationBtn = document.querySelector(SELECTORS.relocationBtn);
                if (relocationBtn) {
                    await actionPause();
                    relocationBtn.click();
                    await actionPause();
                    submitButton = await waitForElement(SELECTORS.modalSubmit, config.waitForModalMs);
                }
            }

            if (!submitButton) {
                if (location.href.includes('/applicant/vacancy_response')) {
                    StateManager.addProcessedID(vid);
                    StateManager.incSessionCount();                                                                             // Инкремент счетчика при редиректе (модалка не появилась, но мы на странице теста)
                    StateManager.clearLastAttemptID();
                    return 'REDIRECT';
                }
                return 'ERROR_NO_MODAL';
            }

            await fillResponsePageData();

            submitButton = submitButton || await waitForElement(SELECTORS.modalSubmit, 2000);
            if (submitButton && !submitButton.disabled) {
                await actionPause();
                submitButton.click();
                await actionPause();
                StateManager.addProcessedID(vid);
                StateManager.clearLastAttemptID();
                StateManager.incSessionCount();                                                                                 // Инкремент общего счетчика откликов
                await wait(1000);
                await actionPause();
                history.back();
                return 'OK';
            }
            return 'ERROR_SUBMIT';
        }

        if (btn) {
            const vacLink = btn.closest(SELECTORS.vacancyCard)?.querySelector(SELECTORS.vacancyLink)
                            || document.querySelector(SELECTORS.vacancyLink);
            if (!vacLink) {
                log('Не найден селектор ссылки вакансии. Проверьте структуру карточки.', true);
                return 'ERROR_NO_LINK';
            }
            return await processVacancyOnListing(vacLink, btn);
        }

        return 'ERROR_UNKNOWN';
    }

    async function startLoop() {                                                                                                // Основной цикл обработчика
        if (isLoopActive) return;

        if (!StateManager.acquireInstanceLock(TAB_ID)) {                                                                        // Пробуем занять instance lock заново
            log('В другой вкладке уже запущен процесс (instance lock). Продолжаю, но возможны дубликаты.', true);
        }

        isLoopActive     = true;
        stopSignal       = false;
        StateManager.setRunning(true);

        const statusEl   = document.getElementById('ar-status-text');
        if(statusEl)     statusEl.textContent = 'В работе';

        let count        = StateManager.getSessionCount();                                                                      // Загружаем текущий прогресс из сессии

        if (count >= config.limit) {
            log(`Лимит (${config.limit}) уже достигнут. Сбросьте историю для продолжения.`);
            isLoopActive = false;
            StateManager.setRunning(false);
            if(statusEl) statusEl.textContent = 'Лимит достигнут';
            return;
        }

        if (location.pathname.startsWith('/applicant/vacancy_response')) {                                                      // Если запущены прямо на странице вопросов
            await fillResponsePageData();
            isLoopActive = false;
            return;
        }

        if (location.pathname.startsWith('/vacancy/')) {                                                                        // Если уже на странице вакансии — обрабатываем её напрямую
            log('На странице вакансии — продолжаю обработку тут.');
            const res    = await processVacancy();
            if (res === 'OK') {
                log('Отклик отправлен. Завершаю цикл для корректного возврата.');
                isLoopActive = false;
                return;
            } else if (res === 'REDIRECT') {
                log('Произошёл редирект/вопрос при обработке. Завершаю; watchdog вернёт нас назад.', true);
                isLoopActive = false;
                StateManager.setRunning(false);
                return;
            } else if (res === 'NO_APPLY_RETURNED' || res === 'ERROR_NO_MODAL' || res === 'ERROR_SUBMIT') {
                log(`Обработка завершилась с кодом ${res}. Завершаю цикл.`, true);
                isLoopActive = false;
                StateManager.setRunning(false);
                return;
            }
        }

        const allBtns    = Array.from(document.querySelectorAll(SELECTORS.applyBtn));
        const processed  = StateManager.getProcessedIDs();

        const targets    = allBtns.filter(b => {
            if (config.skipHidden && b.offsetParent === null) return false;
            return !processed.has(getVacancyID(b));
        });

        log(`Найдено вакансий: ${allBtns.length}. Новых к обработке: ${targets.length}. Текущий счетчик: ${count}`);

        for (const btn of targets) {
            if (stopSignal || count >= config.limit) break;
            if (!document.body.contains(btn)) {
                log('Кнопка исчезла из DOM — перезапускаю поиск.', true);
                break;
            }

            await actionPause();

            const result = await processVacancy(btn);

            if (result === 'OK') {
                count = StateManager.getSessionCount();                                                                         // Получаем обновленное значение после processVacancy
                log(`Отклик #${count} отправлен.`);
                await actionPause();
            } else if (result === 'NAVIGATED') {
                log('Переход на страницу вакансии — завершаю цикл для корректной навигации.');                                  // Перешли на страницу вакансии — завершаем цикл, оставляя флаг running для авто-старта на новой странице
                isLoopActive = false;
                return;
            } else if (result === 'REDIRECT') {
                log('Редирект/внешний тест. Выход из цикла — watchdog займётся возвратом.', true);
                isLoopActive = false;
                StateManager.setRunning(false);
                return;
            } else {
                log(`Ошибка при обработке: ${result}`, true);
            }
        }

        if (!location.href.includes('/applicant/vacancy_response')) {
             isLoopActive = false;
             StateManager.setRunning(false);
             if(statusEl) statusEl.textContent = count >= config.limit ? 'Лимит достигнут' : 'Завершено';
             log(`Работа завершена. Отправлено всего: ${count}`);
        }
    }

    function setupUI() {                                                                                                        // UI — панель с настройками и логом
        if (document.getElementById('ar-main-panel')) return;

    const styles = {
        toggleBtn         : "position: fixed; top: 50%; right: 20px; transform: translateY(-50%); width: 48px; height: 48px; background: #222; color: #fff; border-radius: 50%; display: none; align-items: center; justify-content: center; font-size: 24px; cursor: pointer; z-index: 99999; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 2px solid #fff; user-select: none; transition: all 0.2s;",
        panel             : "position: fixed; bottom: 20px; right: 20px; width: 600px; background: #fff; border: 1px solid #e0e0e0; box-shadow: 0 4px 20px rgba(0,0,0,0.2); border-radius: 12px; z-index: 99999; font-family: sans-serif; font-size: 13px; color: #333; overflow: hidden; display: block;",
        header            : "padding: 12px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; background: #f9f9f9;",
        headerActions     : "display: flex; gap: 8px; align-items: center;",
        status            : "font-weight: bold; color: #666; font-size: 11px;",
        btnMinimize       : "background: none; border: none; cursor: pointer; font-size: 16px; color: #888;",
        container         : "padding: 12px;",
        label             : "display: block; margin-bottom: 8px; cursor: pointer;",
        selectGroup       : "display: flex; gap: 10px;",
        selectCol         : "flex: 1; margin-bottom: 12px;",
        labelSmall        : "font-size: 10px; color: #888; margin-bottom: 2px;",
        textarea          : "width: 100%; box-sizing: border-box; border: 1px solid #ddd; padding: 8px; border-radius: 6px; resize: vertical; margin-bottom: 12px; font-family: inherit;",
        row               : "display: flex; gap: 10px; margin-bottom: 12px;",
        inputGroup        : "display: flex; align-items: center; gap: 4px;",
        input             : "width: 100%; padding: 4px; border: 1px solid #ddd; border-radius: 4px;",
        separator         : "color: #888;",
        actionRow         : "display: flex; gap: 8px; margin-bottom: 8px;",
        btnStart          : "flex: 1; padding: 8px; background: #22c55e; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; transition: opacity 0.2s;",
        btnStop           : "flex: 1; padding: 8px; background: #ef4444; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; transition: opacity 0.2s;",
        utilityRow        : "display: flex; gap: 8px; margin-bottom: 10px;",
        btnSecondary      : "flex: 1; padding: 6px; border-radius: 6px; border: 1px solid #ddd; cursor: pointer;",
        footer            : "padding: 12px; border-top: 1px solid #eee;",
        footerTitle       : "display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;",
        footerActionGroup : "display: flex; gap: 6px;",
        manualList        : "max-height: 120px; overflow: auto; font-size: 12px; border: 1px solid #f0f0f0; padding: 6px; border-radius: 6px; background: #fafafa;",
        emptyMsg          : "color: #666;",
        manualRow         : "display: flex; justify-content: space-between; align-items: center; padding: 6px 4px; border-bottom: 1px solid #eee;",
        manualLeft        : "flex: 1; margin-right: 8px;",
        manualIdText      : "font-size: 11px; color: #333; margin-bottom: 2px;",
        manualLinkBox     : "font-size: 11px; color: #0077cc; word-break: break-all;",
        manualActions     : "display: flex; gap: 6px;",
        manualBtn         : "padding: 4px 6px; border-radius: 6px; border: 1px solid #ddd; cursor: pointer;",
        logBox            : "height: 140px; overflow-y: auto; background: #1e1e1e; color: #00ff00; font-family: monospace; font-size: 11px; padding: 8px; border-top: 1px solid #333;",
        // Export HTML attributes
        exportHtmlBody    : "font-family:Arial,Helvetica,sans-serif;padding:18px;color:#111;background:#fff",
        exportHtmlH2      : "margin:0 0 8px;font-size:18px",
        exportHtmlMeta    : "color:#6b7280;font-size:13px;margin-top:6px",
        exportHtmlTable   : "border-collapse:collapse;width:100%;margin-top:12px",
        exportHtmlTh      : "background:#f7fafc;color:#334155;padding:10px;border:1px solid #eef2f7;text-align:left",
        exportHtmlTd      : "padding:8px;border:1px solid #eef2f7",
        exportHtmlTdNowrap: "padding:8px;border:1px solid #eef2f7;white-space:nowrap;",
        exportHtmlAgo     : "color:#7b8794;font-size:11px",
        exportHtmlLink    : "color:#0b6ef6;text-decoration:none;word-break:break-all"
    };

        const toggleBtn  = document.createElement('div');
        toggleBtn.id            = 'ar-toggle-btn';
        toggleBtn.textContent   = '🤖';
        toggleBtn.style.cssText = styles.toggleBtn;
        document.body.appendChild(toggleBtn);

        const panel              = document.createElement('div');
        panel.id                 = 'ar-main-panel';
        panel.style.cssText      = styles.panel;
        panel.innerHTML = `
            <div style="${styles.header}">
                <b>🤖 HH AutoResponder</b>
                <div style="${styles.headerActions}">
                    <span   id="ar-status-text"  style="${styles.status}">Ожидание</span>
                    <button id="ar-minimize-btn" style="${styles.btnMinimize}">—</button>
                </div>
            </div>
            <div style="${styles.container}">
                <label style="${styles.label}">
                    <input type="checkbox" id="ar-use-cover-check"> Сопроводительное письмо
                </label>
                <div style="${styles.selectGroup}">
                    <div style="${styles.selectCol}">
                        <div style="${styles.labelSmall}">Выберите резюме</div>
                        <select id="ar-resume-select" style="${styles.textarea}; height: auto; padding: 6px;"></select>
                    </div>
                    <div style="${styles.selectCol}">
                        <div style="${styles.labelSmall}">Выберите шаблон</div>
                        <select id="ar-template-select" style="${styles.textarea}; height: auto; padding: 6px;"></select>
                    </div>
                </div>
                <div style="${styles.row}">
                    <div style="flex: 1;">
                        <div style="${styles.labelSmall}">Задержка между действиями (мс)</div>
                        <div style="${styles.inputGroup}">
                            <input type="number" id="ar-min-delay" style="${styles.input}" placeholder="Min">
                            <span style="${styles.separator}">-</span>
                            <input type="number" id="ar-max-delay" style="${styles.input}" placeholder="Max">
                        </div>
                    </div>
                    <div style="width: 60px;">
                        <div style="${styles.labelSmall}">Лимит</div>
                        <input type="number" id="ar-limit-input" style="${styles.input}">
                    </div>
                </div>
                <div style="${styles.row}">
                    <div style="flex:1;">
                        <div style="${styles.labelSmall}">Время чтения вакансии (мс)</div>
                        <div style="${styles.inputGroup}">
                            <input type="number" id="ar-view-min" style="${styles.input}" placeholder="Min">
                            <input type="number" id="ar-view-max" style="${styles.input}" placeholder="Max">
                        </div>
                    </div>
                </div>
                <div style="${styles.row}">
                    <div style="flex:1;">
                        <div style="${styles.labelSmall}">Задержки действий (мс)</div>
                        <div style="${styles.inputGroup}">
                            <input type="number" id="ar-action-min" style="${styles.input}" placeholder="Min">
                            <input type="number" id="ar-action-max" style="${styles.input}" placeholder="Max">
                        </div>
                    </div>
                </div>
                <div style="${styles.actionRow}">
                    <button id="ar-start-btn" style="${styles.btnStart}">START</button>
                    <button id="ar-stop-btn"  style="${styles.btnStop}">STOP</button>
                </div>
                <div style="${styles.utilityRow}">
                    <button id="ar-health-btn"    style="${styles.btnSecondary}">Healthcheck</button>
                    <button id="ar-reset-history" style="${styles.btnSecondary}">Reset history</button>
                </div>
            </div>
            <div style="${styles.footer}">
                <div style="${styles.footerTitle}">
                    <b>Ручной отклик</b>
                    <div style="${styles.footerActionGroup}">
                        <button id="ar-export-manual" style="${styles.btnSecondary}">Export</button>
                        <button id="ar-clear-manual"  style="${styles.btnSecondary}">Clear</button>
                    </div>
                </div>
                <div id="ar-manual-list" style="${styles.manualList}"></div>
            </div>
            <div id="ar-log-box" style="${styles.logBox}"></div>
        `;
        document.body.appendChild(panel);

        const el = (id) => document.getElementById(id);

        // Заполнение выпадающих списков
        config.templates.forEach((template, i) => {
            const opt             = document.createElement('option');
                  opt.value       = i;
                  opt.textContent = template.value.length > 80 ? template.value.slice(0, 80) + '...' : template.value;
            el('ar-template-select').appendChild(opt);
        });
        config.resumes.forEach((resume, i) => {
            const opt             = document.createElement('option');
                  opt.value       = i;
                  opt.textContent = resume.name;
            el('ar-resume-select').appendChild(opt);
        });
 
        // Групповое заполнение полей
        el('ar-template-select').value    = config.selectedTemplate;
        el('ar-resume-select'  ).value    = config.selectedResume;
        el('ar-use-cover-check').checked  = config.useCover;
        el('ar-min-delay'      ).value    = config.delayMin;
        el('ar-max-delay'      ).value    = config.delayMax;
        el('ar-limit-input'    ).value    = config.limit;
        el('ar-view-min'       ).value    = config.viewMin;
        el('ar-view-max'       ).value    = config.viewMax;
        el('ar-action-min'     ).value    = config.actionDelayMin;
        el('ar-action-max'     ).value    = config.actionDelayMax;

        const saveSettings = () => {
            config.useCover         =  el('ar-use-cover-check').checked;
            config.selectedTemplate = +el('ar-template-select').value    || DEFAULTS.selectedTemplate;
            config.selectedResume   = +el('ar-resume-select').value      || DEFAULTS.selectedResume;
            config.delayMin         = +el('ar-min-delay'      ).value    || DEFAULTS.delayMin;
            config.delayMax         = +el('ar-max-delay'      ).value    || DEFAULTS.delayMax;
            config.limit            = +el('ar-limit-input'    ).value    || DEFAULTS.limit;
            config.viewMin          = +el('ar-view-min'       ).value    || DEFAULTS.viewMin;
            config.viewMax          = +el('ar-view-max'       ).value    || DEFAULTS.viewMax;
            config.actionDelayMin   = +el('ar-action-min'     ).value    || DEFAULTS.actionDelayMin;
            config.actionDelayMax   = +el('ar-action-max'     ).value    || DEFAULTS.actionDelayMax;
            if (config.delayMin       > config.delayMax)       [config.delayMin,       config.delayMax]       = [config.delayMax,       config.delayMin];
            if (config.viewMin        > config.viewMax)        [config.viewMin,        config.viewMax]        = [config.viewMax,        config.viewMin];
            if (config.actionDelayMin > config.actionDelayMax) [config.actionDelayMin, config.actionDelayMax] = [config.actionDelayMax, config.actionDelayMin];
            StateManager.saveConfig(config);
            log('Настройки сохранены.');
        };

        ['ar-template-select', 'ar-resume-select', 'ar-use-cover-check', 'ar-min-delay', 'ar-max-delay', 'ar-limit-input', 'ar-view-min', 'ar-view-max', 'ar-action-min', 'ar-action-max'].forEach(id => el(id).addEventListener('change', saveSettings));

        el('ar-start-btn'    ).onclick = startLoop;
        el('ar-stop-btn'     ).onclick = () => {
                                                   stopSignal   = true;
                                                   isLoopActive = false;
                                                   StateManager.setRunning(false);
                                                   el('ar-status-text').textContent = 'Остановлено';
                                                   StateManager.releaseInstanceLock(TAB_ID);
                                                   log('Остановлено пользователем.');
                                               };
        el('ar-reset-history').onclick = () => {
                                                   StateManager.clearProcessedIDs();
                                                   log('История откликов и счетчик сброшены.');
                                               };
        el('ar-health-btn'   ).onclick = () => {
                                                   runHealthCheck();
                                               };
        el('ar-clear-manual' ).onclick = () => {
                                                   if (confirm('Очистить сохранённый список вакансий для ручного отклика?')) {
                                                       StateManager.clearManualList();
                                                       renderManualList();
                                                       log('Список для ручного отклика очищен.');
                                                   }
                                               };
        el('ar-export-manual').onclick = () => {                                                                                // Export: HTML, humanized dates, single URL column, dedupe by URL
            const list   = StateManager.getManualList();
            if (!list || !list.length) { alert('Список пуст'); return; }

            const seen   = new Set();                                                                                           // dedupe by url (avoid duplicate identical links)
            const uniq   = [];
            for (const it of list) {
                const key = String(it.url || it.vid || '').trim();
                if (!key) continue;
                if (seen.has(key)) continue;
                seen.add(key);
                uniq.push(it);
            }

            const esc    = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

            const humanAgo = (ts) => {
                const d  = Date.now() - ts;
                const sec = Math.floor(d  /1000); if (sec < 60) return sec + 's';
                const min = Math.floor(sec/60);   if (min < 60) return min + 'm';
                const hr  = Math.floor(min/60);   if (hr  < 24) return hr  + 'h';
                const day = Math.floor(hr /24);                 return day + 'd';
            };

            const rows   = uniq.map(i => {
                const ts      = new Date(i.ts || Date.now());
                const timestr = ts.toLocaleString();
                const ago     = humanAgo(i.ts || Date.now());
                const vid     = esc(i.vid   || '');
                const title   = esc(i.title || '');
                const url     = esc(i.url   || '');
                return `
                <tr>
                    <td style="${styles.exportHtmlTdNowrap}">${timestr}<div style="${styles.exportHtmlAgo}">${ago} ago</div></td>
                    <td style="${styles.exportHtmlTd}">${vid}</td>
                    <td style="${styles.exportHtmlTd}"><a href="${url}" target="_blank" rel="noopener noreferrer" style="${styles.exportHtmlLink}">${title || url}</a></td>
                </tr>`;
            }).join('');

            const content = `<!doctype html>
                             <html>
                             <head>
                                 <meta charset="utf-8">
                                 <title>HH Manual List</title>
                                 <meta name="viewport" content="width=device-width,initial-scale=1">
                             </head>
                             <body style="${styles.exportHtmlBody}">
                                 <h2 style="${styles.exportHtmlH2}">Saved vacancies for manual responses</h2>
                                 <div style="${styles.exportHtmlMeta}">Export date: ${new Date().toLocaleString()} — ${uniq.length} item(s)</div>
                                 <table style="${styles.exportHtmlTable}">
                                     <thead>
                                         <tr>
                                             <th style="${styles.exportHtmlTh}">saved</th>
                                             <th style="${styles.exportHtmlTh}">vid</th>
                                             <th style="${styles.exportHtmlTh}">link</th>
                                         </tr>
                                     </thead>
                                     <tbody>
                                         ${rows}
                                     </tbody>
                                 </table>
                             </body>
                             </html>`.trim();
            const blob    = new Blob([content], { type : 'text/html;charset=utf-8' });
            const urlBlob = URL.createObjectURL(blob);
            const a       = document.createElement('a'); a.href = urlBlob; a.download = 'hh_manual_list.html';
            document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(urlBlob);
            log('HTML экспорт выполнен.');
        };

        const toggleVisibility = (isOpen) => {
            panel.style.display     = isOpen ? 'block' : 'none';
            toggleBtn.style.display = isOpen ? 'none'  : 'flex';
        };
        el('ar-minimize-btn').onclick = () => toggleVisibility(false);
        toggleBtn.onclick = () => toggleVisibility(true);

        function renderManualList() {                                                                                           // render manual list in UI
            const container = document.getElementById('ar-manual-list');
            if (!container) return;
            container.innerHTML = '';
            const list   = StateManager.getManualList();
            if (!list || !list.length) {
                container.innerHTML = `<div style="${styles.emptyMsg}">Пусто</div>`;
                return;
            }
            list.forEach(item => {
                const row = document.createElement('div');
                      row.style.cssText       = styles.manualRow;
                const time                    = new Date(item.ts).toLocaleString();
                const left                    = document.createElement('div');
                      left.style.cssText      = styles.manualLeft;
                      left.innerHTML          = `
                                                <div style="${styles.manualIdText}">
                                                    ${item.vid} • ${time}
                                                </div>
                                                <div style="${styles.manualLinkBox}">
                                                    <a href="${item.url}" target="_blank">Открыть страницу с вопросами</a>
                                                </div>
                                                `;
                const actions                 = document.createElement('div');
                      actions.style.cssText   = styles.manualActions;
                const openBtn                 = document.createElement('button');
                      openBtn.textContent     = 'Open';
                      openBtn.style.cssText   = styles.manualBtn;
                      openBtn.onclick         = () => window.open(item.url, '_blank');
                const removeBtn               = document.createElement('button');
                      removeBtn.textContent   = 'Remove';
                      removeBtn.style.cssText = styles.manualBtn;
                      removeBtn.onclick       = () => { StateManager.removeManualEntry(item.vid); renderManualList(); };

                actions.appendChild(openBtn);
                actions.appendChild(removeBtn);

                row.appendChild(left);
                row.appendChild(actions);
                container.appendChild(row);
            });
        }

        renderManualList();                                                                                                     // initial render
        window._hh_ar_renderManualList = renderManualList;                                                                      // expose render function for other parts of script
    }

    function runHealthCheck() {                                                                                                 // Пробегает по ключевым селекторам и пишет результат в лог
        const checks     = [
            { name : 'Кнопка отклика (list)',                 sel : SELECTORS.applyBtn },
            { name : 'Верхняя кнопка отклика (vacancy page)', sel : SELECTORS.topApply },
            { name : 'Ссылка вакансии (card)',                sel : SELECTORS.vacancyLink },
            { name : 'modal submit',                          sel : SELECTORS.modalSubmit },
            { name : 'modal textarea',                        sel : SELECTORS.modalTextarea },
            { name : 'resume dropdown',                       sel : SELECTORS.resumeDropdown },
            { name : 'cover toggle (unified)',                sel : SELECTORS.coverToggle }
        ];
        log('Запускаю HealthCheck...');
        checks.forEach(c => {
            const found  = document.querySelector(c.sel);
            log(`${c.name}: ${found ? 'OK' : 'НЕ НАЙДЕНО'} (${c.sel})`, !found);
        });
        const raw        = localStorage.getItem(KEYS.instanceLock);
        if (raw) {
            try {
                const obj = JSON.parse(raw);
                log(`Instance lock: tabId=${obj.tabId} ts=${new Date(obj.ts).toLocaleTimeString()}`);
            } catch (e)  { log('Instance lock: ошибка чтения', true); }
        } else {
            log('Instance lock: отсутствует');
        }
    }

    watchTheURL();                                                                                                              // Инициализация

    const domReadyObserver = new MutationObserver((mutations, obs) => {
        if (document.body) {
            setupUI();
            if (StateManager.amIRunning()) {                                                                                    // Авто-возобновление, если скрипт был в работе перед перезагрузкой
                log('Обнаружена незавершенная работа. Авто-возобновление через 1.5 сек...');
                const statusEl = document.getElementById('ar-status-text');
                if(statusEl)   statusEl.textContent = 'Авто-запуск...';
                setTimeout(() => {
                    const startButton = document.getElementById('ar-start-btn');
                    if (startButton) startButton.click();
                }, 1500);
            }
            StateManager.clearTrapLock();                                                                                       // Сбрасываем ловушку при открытии новых страниц
            obs.disconnect();
        }
    });
    domReadyObserver.observe(document.documentElement, { childList : true, subtree : true });

    window.addEventListener('beforeunload', () => {                                                                             // Очищаем instance lock при закрытии вкладки
        StateManager.releaseInstanceLock(TAB_ID);
    });
    window.addEventListener('unload', () => {
        StateManager.releaseInstanceLock(TAB_ID);
    });
})();