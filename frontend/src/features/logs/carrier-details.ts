/**
 * The parts of a log sheet a driver fills in by hand.
 *
 * Everything else on the sheet is computed from the trip, but these fields are not
 * derivable from anything the planner knows — and a sheet with the carrier, terminal and
 * shipping boxes left empty reads as a demo rather than as a filled log. They are kept in
 * local storage rather than on the trip so they survive re-planning, which matches how
 * they behave in practice: the truck and the carrier stay the same across loads.
 */

import { useCallback, useEffect, useState } from "react";

export interface CarrierDetails {
  carrier: string;
  officeAddress: string;
  terminalAddress: string;
  vehicles: string;
  shippingDocuments: string;
  manifestNumber: string;
  shipperCommodity: string;
}

export const EMPTY_CARRIER_DETAILS: CarrierDetails = {
  carrier: "",
  officeAddress: "",
  terminalAddress: "",
  vehicles: "",
  shippingDocuments: "",
  manifestNumber: "",
  shipperCommodity: "",
};

export const CARRIER_FIELDS: Array<{ key: keyof CarrierDetails; label: string; placeholder: string }> = [
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
    // Spread over the defaults rather than trusting the parsed object: a stored value from
    // an older shape would otherwise leave fields undefined and render "undefined" onto
    // the sheet.
    return { ...EMPTY_CARRIER_DETAILS, ...(JSON.parse(raw) as Partial<CarrierDetails>) };
  } catch {
    return EMPTY_CARRIER_DETAILS;
  }
}

export function useCarrierDetails(): [CarrierDetails, (key: keyof CarrierDetails, value: string) => void] {
  const [details, setDetails] = useState<CarrierDetails>(EMPTY_CARRIER_DETAILS);

  // Read after mount rather than in the initialiser so the first render does not depend on
  // storage, which keeps this usable if the app is ever server-rendered.
  useEffect(() => {
    setDetails(read());
  }, []);

  const update = useCallback((key: keyof CarrierDetails, value: string) => {
    setDetails((previous) => {
      const next = { ...previous, [key]: value };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // A private-mode browser refusing storage must not stop the driver typing.
      }
      return next;
    });
  }, []);

  return [details, update];
}
