// Non-breaking spaces keep groups of three digits together on narrow screens.
const uiIntegerFormatter = new Intl.NumberFormat('ru-RU', { useGrouping: true, maximumFractionDigits: 0 });
function formatUIInteger(value) { return uiIntegerFormatter.format(value); }
