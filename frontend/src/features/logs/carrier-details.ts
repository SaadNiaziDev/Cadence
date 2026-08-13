// Carrier boxes are kept in local storage so they survive re-planning. From and To
// default from the trip and are not persisted, so a new plan does not keep the last one.

import { useCallback, useEffect, useState } from "react";

export interface CarrierDetails {
  from: string;
  to: string;
  carrier: string;
  officeAddress: string;
  terminalAddress: string;
  vehicles: string;
  shippingDocuments: string;
  manifestNumber: string;
  shipperCommodity: string;
}

export const EMPTY_CARRIER_DETAILS: CarrierDetails = {
  from: "",
  to: "",
  carrier: "",
  officeAddress: "",
  terminalAddress: "",
  vehicles: "",
  shippingDocuments: "",
  manifestNumber: "",
  shipperCommodity: "",
};

export const CARRIER_FIELDS: Array<{ key: keyof CarrierDetails; label: string; placeholder: string }> = [
  { key: "from", label: "From", placeholder: "Chicago, IL" },
  { key: "to", label: "To", placeholder: "Atlanta, GA" },
  { key: "carrier", label: "Name of carrier", placeholder: "Bluebird Freight LLC" },
  { key: "officeAddress", label: "Main office address", placeholder: "1400 W Belt Line Rd, Dallas, TX" },
  { key: "terminalAddress", label: "Home terminal address", placeholder: "2200 Industrial Blvd, Dallas, TX" },
  { key: "vehicles", label: "Truck/tractor and trailer numbers", placeholder: "Tractor 4417 / Trailer 8802 (TX)" },
  { key: "shippingDocuments", label: "Shipping documents", placeholder: "BOL 55210" },
  { key: "manifestNumber", label: "DVL or manifest no.", placeholder: "MAN-3391" },
  { key: "shipperCommodity", label: "Shipper & commodity", placeholder: "Cargill — palletised grain" },
];

const STORAGE_KEY = "hos.carrier-details";

function read(): CarrierDetails {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_CARRIER_DETAILS;
    // Spread over the defaults: a value stored under an older shape would otherwise leave
    // fields undefined and render "undefined" onto the sheet.
    return { ...EMPTY_CARRIER_DETAILS, ...(JSON.parse(raw) as Partial<CarrierDetails>) };
  } catch {
    return EMPTY_CARRIER_DETAILS;
  }
}

export function useCarrierDetails(): [CarrierDetails, (key: keyof CarrierDetails, value: string) => void] {
  const [details, setDetails] = useState<CarrierDetails>(EMPTY_CARRIER_DETAILS);

  // Read after mount so the first render does not depend on storage.
  useEffect(() => {
    setDetails(read());
  }, []);

  const update = useCallback((key: keyof CarrierDetails, value: string) => {
    setDetails((previous) => {
      const next = { ...previous, [key]: value };
      try {
        const persisted: Omit<CarrierDetails, "from" | "to"> = {
          carrier: next.carrier,
          officeAddress: next.officeAddress,
          terminalAddress: next.terminalAddress,
          vehicles: next.vehicles,
          shippingDocuments: next.shippingDocuments,
          manifestNumber: next.manifestNumber,
          shipperCommodity: next.shipperCommodity,
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
      } catch {
        // Private-mode browsers refuse storage; typing must still work.
      }
      return next;
    });
  }, []);

  return [details, update];
}
