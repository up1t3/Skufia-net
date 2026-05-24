# E2E Test Infra: SKUFenger Redesign

## Test Philosophy
- Opaque-box, requirement-driven. No dependency on implementation design.
- Methodology: Category-Partition + BVA + Pairwise + Workload Testing.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 (Feature) | Tier 2 (Boundaries) | Tier 3 (Cross-feature) |
|---|---------|---------------------|:------:|:------:|:------:|
| 1 | Мобильная адаптивность и Safe Areas | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 2 | Виртуальная клавиатура | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 3 | Предотвращение зума на iOS | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 4 | Нативные жесты (Swipe-to-Back) | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |
| 5 | Темы оформления и color-mix | ORIGINAL_REQUEST §R5 | 5 | 5 | ✓ |

## Test Architecture
- **Test Runner**: Playwright
- **Invocation Command**: `TEST_URL=http://localhost:8008 npx playwright test`
- **Directory Layout**:
  - `tests/e2e/playwright.config.ts` — Конфигурация Playwright ( Desktop Chrome, Mobile Safari, Mobile Chrome)
  - `tests/e2e/auth.spec.ts` — Тесты авторизации
  - `tests/e2e/chat-pipeline.spec.ts` — Тест основного пайплайна
  - `tests/e2e/chat-media.spec.ts` — Тесты медиа и вложений
  - `tests/e2e/mobile-rtc.spec.ts` — Тесты WebRTC звонков на мобильных

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Вход пользователя с мобильного устройства, открытие чата, скрытие клавиатуры, возврат жестом свайпа | R1, R2, R4, R5 | High |
| 2 | Переключение на светлую тему Light OS, вызов контекстного меню сообщения, проверка читаемости и цветов | R5 | Medium |
| 3 | Отправка медиафайлов, проверка безопасного расширения (валидация на клиенте), прогресс-бар | R5 | Medium |

## Coverage Thresholds
- **Tier 1 (Feature Coverage)**: ≥5 тестов на фичу (основные сценарии)
- **Tier 2 (Boundary & Corner Cases)**: ≥5 тестов на фичу (граничные условия, например, сдвиг свайпа ровно на 120px, 119px, 121px)
- **Tier 3 (Cross-Feature Combinations)**: попарное пересечение фич (например, свайп во время фокуса на инпуте)
- **Tier 4 (Real-World Scenarios)**: не менее 5 комплексных пользовательских сценариев
