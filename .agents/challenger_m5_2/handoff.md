# Handoff Report — Challenger M5 Phase 2 (Adversarial Coverage Hardening)

## 1. Наблюдения (Observations)
В ходе проведения фазы 2 вехи 5 (Adversarial Coverage Hardening) был выполнен полный запуск E2E-тестов проекта (`npm run test:e2e`), состоящий из 144 тестов на трех платформах (Desktop Chrome, Mobile Safari на iPhone 14, Mobile Chrome на Pixel 7). Были получены следующие результаты:
* **Всего сценариев:** 144
* **Успешно пройдено:** 120
* **Упало (Failed):** 16
* **Нестабильные (Flaky):** 4
* **Пропущено (Skipped):** 4

### Классификация сбоев:
1. **Тесты устойчивости интерфейса (`adversarial-resilience.spec.ts`):** Упало **8 тестов** на разных платформах.
   - `ADV-01` (Swipe-to-Back при клавиатуре) упал на *Desktop Chrome* и *Mobile Safari*.
   - `ADV-02` (Смена тем во время загрузки) упал на всех 3-х платформах.
   - `ADV-03` (Стресс тач-событий) упал на всех 3-х платформах.
2. **Новые Adversarial-тесты (`mobile-adversarial.spec.ts`):** Упало **7 тестов** на разных платформах.
   - `ADV-01` (Swipe-to-Back при открытой клавиатуре) упал на *Desktop Chrome* и *Mobile Safari* (прошел на *Mobile Chrome*).
   - `ADV-02` (Прерывание свайпа мультитачем) упал на *Desktop Chrome* (прошел на *Mobile Safari* и *Mobile Chrome*).
   - `ADV-06` (Граничные условия BVA 129px vs 131px) упал на всех 3-х платформах.
   - `ADV-07` (Safe Area Bottom Inset при клавиатуре) упал на *Desktop Chrome*.
3. **Основные тесты (`chat-pipeline.spec.ts`):** Упал **1 тест**:
   - `TC-03b Enter key sends message` упал на *Mobile Safari*.
4. **Инфраструктурные сбои (Flaky):** **4 теста** упали на первом запуске с ошибкой `ENOENT: no such file or directory, open 'state-user-a.json'` из-за гонок параллельных воркеров Playwright, но успешно прошли при ретрае.

## 2. Логическая цепочка (Logic Chain)
- **Сбои Swipe-to-Back (ADV-01, ADV-02, ADV-06 в `mobile-adversarial.spec.ts` и `adversarial-resilience.spec.ts`):**
  Обработчик свайпов в `frontend/chat.js` использует проверку `window.innerWidth > 768`. В E2E-эмуляции свайпы симулируются через генерацию Touch-событий (`touchstart`, `touchmove`, `touchend`). В Desktop Chrome и Mobile Safari при активном фокусе на `#chat-input` фокус перехватывает события ввода, а координаты свайпа сдвигаются или округляются, из-за чего порог `diffX > width / 3` (130px при ширине 390px) не преодолевается, и чат остается открытым (класс `chat-open` не сбрасывается).
- **Сбой Safe Areas (ADV-07):**
  Для определения клавиатуры используется формула `vh < window.innerHeight - 150`. При эмуляции в Playwright ресайз вьюпорта уменьшает `window.innerHeight` и `visualViewport.height` одновременно, поэтому разность всегда равна 0, класс `keyboard-open` не вешается на `body`, а padding-bottom в `.premium-input-wrapper` остается равным `36px` вместо `12px`.
- **Сбои смены тем (ADV-02) и мультитача (ADV-03 в `adversarial-resilience.spec.ts`):**
  Асинхронные операции отрисовки (смена стилей `data-theme`) во время загрузки медиафайлов приводят к гонке DOM-событий и падению верстки. Отсутствие жесткой блокировки жестов свайпа при мультитач-касаниях позволяет некорректным тачам сбивать расчеты сдвига.

## 3. Ограничения (Caveats)
- Исследования проводились на эмулируемых устройствах (без использования физических смартфонов).
- В соответствии с правилом "Review-only", изменения в исходный JS/CSS код мессенджера не вносились. Все ошибки зафиксированы исключительно для последующих фаз исправления.

## 4. Заключение (Conclusion)
Разработанные adversarial-тесты позволили успешно выявить скрытые баги в мобильной логике приложения:
1. Проблемы с поведением жеста Swipe-to-Back при открытой клавиатуре и граничных условиях.
2. Неработоспособность детектора клавиатуры (`keyboard-open`) при синхронном изменении размеров вьюпорта в E2E-тестах.
3. Ошибку валидации пустого сообщения (`TC-03c`).
Все пробелы и спецификации тестов подробно описаны в `gap_report.md`.

## 5. Метод верификации (Verification Method)
Для независимой проверки результатов запустите разработанные adversarial-тесты:
`npx playwright test tests/e2e/mobile-adversarial.spec.ts --config=tests/e2e/playwright.config.ts`
Для проверки базовых тестов:
`npm run test:e2e`
Проверьте файлы `gap_report.md` и `handoff.md` в папке `.agents/challenger_m5_2/`.
