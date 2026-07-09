"use client";

import { Filter, Search } from "lucide-react";
import { Card, FormLabel, Input, Select } from "@/components/natalie-ui";
import type { ClientItem } from "./types";

export function InvoicesFiltersCard({
  title,
  clientId,
  clients,
  allClientsLabel,
  search,
  searchPlaceholder,
  fromDate,
  toDate,
  fromLabel,
  toLabel,
  onClientChange,
  onSearchChange,
  onFromDateChange,
  onToDateChange,
}: {
  title: string;
  clientId: string;
  clients: ClientItem[];
  allClientsLabel: string;
  search: string;
  searchPlaceholder: string;
  fromDate: string;
  toDate: string;
  fromLabel: string;
  toLabel: string;
  onClientChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
}) {
  return (
    <Card>
      <div className="mb-4 flex items-center gap-2 text-lg font-black text-[var(--natalie-text-primary,#0F172A)]">
        <Filter className="h-5 w-5" />
        {title}
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        <FormLabel>
          <Select className="mt-1" value={clientId} onChange={(e) => onClientChange(e.target.value)}>
            <option value="all">{allClientsLabel}</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        </FormLabel>
        <div className="relative xl:col-span-2">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--natalie-text-muted,#64748B)]" />
          <Input
            className="pr-10"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <FormLabel>
          {fromLabel}
          <Input className="mt-1" type="date" value={fromDate} onChange={(e) => onFromDateChange(e.target.value)} />
        </FormLabel>
        <FormLabel>
          {toLabel}
          <Input className="mt-1" type="date" value={toDate} onChange={(e) => onToDateChange(e.target.value)} />
        </FormLabel>
      </div>
    </Card>
  );
}
