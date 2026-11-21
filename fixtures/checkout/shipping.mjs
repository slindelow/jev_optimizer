export function setShippingAddress(checkout, newAddress) {
  return { ...checkout, address: newAddress, selectedRate: null };
}
