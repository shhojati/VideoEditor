import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import fa from './fa.json';

export type Lang = 'fa' | 'en';
const STORAGE_KEY = 'ui-lang';

function storedLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'en' || v === 'fa' ? v : 'fa';
  } catch {
    return 'fa';
  }
}

/** Keep <html lang/dir> in sync so the whole layout mirrors for Persian. */
function applyDocumentDirection(lang: string) {
  document.documentElement.lang = lang;
  document.documentElement.dir = i18n.dir(lang);
  document.title = i18n.t('app.title');
}

void i18n.use(initReactI18next).init({
  resources: { fa: { translation: fa }, en: { translation: en } },
  lng: storedLang(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});
applyDocumentDirection(i18n.language);
i18n.on('languageChanged', (lng) => {
  applyDocumentDirection(lng);
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // storage unavailable: language just won't be remembered
  }
});

export default i18n;
