import { Check, Press, T, tx } from "../kit/compat";
import { useEngineScopedModelList } from "./EngineScopedModelList.styles";
import { useProviderModelPicker } from "./ProviderModelPicker.styles";
import { useT } from "@/shared/i18n";
export function EngineScopedModelList({ engineLabel, models, value, onSelect, loading = false, disabled = false, emptyMessage, hideHead = false, selectedRowExtra = null, }) {
  const s = useEngineScopedModelList();
  const sProviderModelPicker = useProviderModelPicker();
    const t = useT();
    return (<col {...s.engineScopedModelList} label={t("settings.engineModels.ariaLabel", { engine: engineLabel })}>
      {hideHead ? null : (<row {...s.engineScopedModelListHead}>
          <T {...tx(s.engineScopedModelListHead)}>{engineLabel}</T>
        </row>)}
      <col {...s.engineScopedModelListRows}>
        {loading && models.length === 0 ? (<T w="full">{t("settings.engineModels.loading", { engine: engineLabel })}</T>) : models.length === 0 ? (emptyMessage === null ? null : (<T w="full">{emptyMessage ?? t("settings.engineModels.empty", { engine: engineLabel })}</T>)) : (models.map((model) => {
            const selected = model.id === value;
            return (<col {...s.engineScopedModelListRowSlot} key={model.id}>
                <Press selected={selected} aria-disabled={model.unavailable || undefined} disabled={disabled || model.unavailable} onPress={() => onSelect(model.id)}>
                  <col {...s.engineScopedModelListText}>
                    <T {...s.engineScopedModelListName}>
                      {model.label}
                    </T>
                    {model.description ? (<T {...s.engineScopedModelListDescription}>
                        {model.description}
                      </T>) : null}
                  </col>
                  {selected ? (<Check size={13} {...s.engineScopedModelListCheck} color={s.engineScopedModelListCheck.color} />) : null}
                </Press>
                {selected && selectedRowExtra ? (<T w="full" {...sProviderModelPicker.modelPickerSelectedExtra}>{selectedRowExtra}</T>) : null}
              </col>);
        }))}
      </col>
    </col>);
}
