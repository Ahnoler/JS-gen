"""Case data storage actions for cross-phase data sharing."""

from ._helpers import _ok, _err


def _register_case_data_actions(controller, case_data_store):
    @controller.action('Save data to the shared case data store for cross-phase data sharing.')
    async def save_case_data(key: str, value: str):
        try:
            case_data_store[key] = value
            return _ok(f'saved:{key}={value}')
        except Exception as e:
            return _err(f'save-error:{e}')

    @controller.action('Read data from the shared case data store.')
    async def read_case_data(key: str):
        val = case_data_store.get(key)
        if val is None:
            return _err(f'NO-DATA:{key}')
        return val
