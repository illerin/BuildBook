import { makeId } from './data';

export function storageLabel(containerName, slotName = '') {
  return [containerName, slotName].map((value) => String(value || '').trim()).filter(Boolean).join(' / ');
}

export function storageSelectionFromPart(part, storageLocations) {
  const container = storageLocations.find((location) => location.id === part.storageContainerId)
    || storageLocations.find((location) => location.name.toLowerCase() === String(part.storageLocation || '').split('/')[0]?.trim().toLowerCase());
  const slot = container?.slots?.find((item) => item.id === part.storageSlotId);
  return {
    containerId: container?.id || '',
    slotId: slot?.id || '',
  };
}

export function applyStorageSelection(storageLocations, selection) {
  let locations = (storageLocations || []).map((location) => ({
    ...location,
    slots: Array.isArray(location.slots) ? [...location.slots] : [],
  }));
  let containerId = selection.containerId || '';
  let slotId = selection.slotId || '';

  if (selection.newContainerName?.trim()) {
    const name = selection.newContainerName.trim();
    const existing = locations.find((location) => location.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      containerId = existing.id;
    } else {
      const container = { id: makeId('storage'), name, slots: [] };
      locations = [...locations, container];
      containerId = container.id;
    }
  }

  if (selection.newSlotName?.trim() && containerId) {
    const name = selection.newSlotName.trim();
    locations = locations.map((location) => {
      if (location.id !== containerId) return location;
      const existing = location.slots.find((slot) => slot.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        slotId = existing.id;
        return location;
      }
      const slot = { id: makeId('slot'), name };
      slotId = slot.id;
      return { ...location, slots: [...location.slots, slot].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })) };
    });
  }

  const container = locations.find((location) => location.id === containerId);
  const slot = container?.slots?.find((item) => item.id === slotId);
  return {
    storageLocations: locations.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })),
    partPatch: {
      storageContainerId: container?.id || '',
      storageSlotId: slot?.id || '',
      storageLocation: storageLabel(container?.name, slot?.name),
    },
  };
}
