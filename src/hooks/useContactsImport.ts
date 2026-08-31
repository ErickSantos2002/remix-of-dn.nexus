import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { normalizePhone } from "@/lib/phone";
import { getDefaultTagColor, parseTags } from "@/types/tags";
import type { ContactTag } from "@/types/tags";
import type { Json } from "@/integrations/supabase/types";

export type ImportStep = 1 | 2 | 3 | 4 | 5;
export type ImportMethod = "csv" | "google_sheets" | null;
export type DuplicateAction = "ignore" | "overwrite";

interface ColumnMapping {
  nome: number;
  telefone: number;
  email: number;
  empresa: number;
  cargo: number;
  posicao: number;
  tamanho_empresa: number;
  faturamento: number;
  observacoes: number;
  tags: number;
}

interface ValidationError {
  row: number;
  field: string;
  message: string;
}

interface DuplicateContact {
  row: number;
  phone: string;
  name: string;
  existingId?: string;
  isInFile?: boolean;
}

export interface ValidationResult {
  validRows: number[];
  errorRows: ValidationError[];
  duplicatesInFile: DuplicateContact[];
  duplicatesInDb: DuplicateContact[];
  totalRows: number;
}

export interface ImportProgress {
  total: number;
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  isComplete: boolean;
  isCancelled: boolean;
}

export interface ImportState {
  step: ImportStep;
  method: ImportMethod;
  file: File | null;
  rawData: string[][];
  headers: string[];
  mappedColumns: ColumnMapping | null;
  validationResult: ValidationResult | null;
  duplicateAction: DuplicateAction;
  commonTag: string;
  importProgress: ImportProgress;
}

const EXPECTED_COLUMNS = [
  "nome",
  "telefone",
  "email",
  "empresa",
  "cargo",
  "posicao",
  "tamanho_empresa",
  "faturamento",
  "observacoes",
  "tags",
];

const REQUIRED_COLUMNS = ["nome", "telefone"];

const initialProgress: ImportProgress = {
  total: 0,
  processed: 0,
  inserted: 0,
  updated: 0,
  skipped: 0,
  errors: 0,
  isComplete: false,
  isCancelled: false,
};

const initialState: ImportState = {
  step: 1,
  method: null,
  file: null,
  rawData: [],
  headers: [],
  mappedColumns: null,
  validationResult: null,
  duplicateAction: "ignore",
  commonTag: "",
  importProgress: initialProgress,
};

export function useContactsImport(workspaceId: string | undefined) {
  const [state, setState] = useState<ImportState>(initialState);
  const [cancelFlag, setCancelFlag] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const reset = useCallback(() => {
    setState(initialState);
    setCancelFlag(false);
  }, []);

  const setStep = useCallback((step: ImportStep) => {
    setState((prev) => ({ ...prev, step }));
  }, []);

  const setMethod = useCallback((method: ImportMethod) => {
    setState((prev) => ({ ...prev, method }));
  }, []);

  const setDuplicateAction = useCallback((action: DuplicateAction) => {
    setState((prev) => ({ ...prev, duplicateAction: action }));
  }, []);

  const setCommonTag = useCallback((tag: string) => {
    setState((prev) => ({ ...prev, commonTag: tag }));
  }, []);

  /**
   * Parses CSV file content using semicolon as delimiter
   * Handles fields with newlines inside quotes correctly
   */
  const parseCSVFile = useCallback(async (file: File): Promise<boolean> => {
    return new Promise((resolve) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          // Remove BOM if present
          const cleanText = text.replace(/^\uFEFF/, "");

          // Parse CSV character by character to handle newlines inside quoted fields
          const rawData: string[][] = [];
          let currentRow: string[] = [];
          let currentField = "";
          let inQuotes = false;

          for (let i = 0; i < cleanText.length; i++) {
            const char = cleanText[i];
            const nextChar = cleanText[i + 1];

            if (char === '"') {
              if (inQuotes && nextChar === '"') {
                // Escaped quote inside quoted field
                currentField += '"';
                i++;
              } else {
                // Toggle quote mode
                inQuotes = !inQuotes;
              }
            } else if (char === ";" && !inQuotes) {
              // Field separator
              currentRow.push(currentField.trim());
              currentField = "";
            } else if ((char === "\n" || (char === "\r" && nextChar === "\n")) && !inQuotes) {
              // Row separator (outside quotes)
              if (char === "\r") i++; // Skip \n in \r\n
              currentRow.push(currentField.trim());
              if (currentRow.some((field) => field !== "")) {
                rawData.push(currentRow);
              }
              currentRow = [];
              currentField = "";
            } else if (char === "\r" && !inQuotes) {
              // Handle standalone \r as row separator
              currentRow.push(currentField.trim());
              if (currentRow.some((field) => field !== "")) {
                rawData.push(currentRow);
              }
              currentRow = [];
              currentField = "";
            } else {
              // Regular character (including newlines inside quotes)
              currentField += char;
            }
          }

          // Don't forget the last field and row
          currentRow.push(currentField.trim());
          if (currentRow.some((field) => field !== "")) {
            rawData.push(currentRow);
          }

          if (rawData.length < 2) {
            toast({
              title: "Arquivo vazio",
              description: "O arquivo precisa ter pelo menos uma linha de cabeçalho e uma de dados",
              variant: "destructive",
            });
            resolve(false);
            return;
          }

          const headers = rawData[0].map((h) => h.toLowerCase().trim());

          setState((prev) => ({
            ...prev,
            file,
            rawData,
            headers,
          }));

          resolve(true);
        } catch (error) {
          console.error("CSV parse error:", error);
          toast({
            title: "Erro ao ler arquivo",
            description: "Não foi possível processar o arquivo CSV",
            variant: "destructive",
          });
          resolve(false);
        }
      };

      reader.onerror = () => {
        toast({
          title: "Erro ao ler arquivo",
          description: "Não foi possível ler o arquivo",
          variant: "destructive",
        });
        resolve(false);
      };

      reader.readAsText(file, "UTF-8");
    });
  }, [toast]);

  /**
   * Validates CSV columns and creates mapping
   */
  const validateColumns = useCallback((): { valid: boolean; missingColumns: string[] } => {
    const headers = state.headers;
    const missingColumns: string[] = [];

    // Check required columns
    for (const col of REQUIRED_COLUMNS) {
      if (!headers.includes(col)) {
        missingColumns.push(col);
      }
    }

    if (missingColumns.length > 0) {
      return { valid: false, missingColumns };
    }

    // Create column mapping
    const mapping: ColumnMapping = {
      nome: headers.indexOf("nome"),
      telefone: headers.indexOf("telefone"),
      email: headers.indexOf("email"),
      empresa: headers.indexOf("empresa"),
      cargo: headers.indexOf("cargo"),
      posicao: headers.indexOf("posicao"),
      tamanho_empresa: headers.indexOf("tamanho_empresa"),
      faturamento: headers.indexOf("faturamento"),
      observacoes: headers.indexOf("observacoes"),
      tags: headers.indexOf("tags"),
    };

    setState((prev) => ({ ...prev, mappedColumns: mapping }));

    return { valid: true, missingColumns: [] };
  }, [state.headers]);

  /**
   * Validates data rows for required fields and duplicates
   */
  const validateData = useCallback(async (): Promise<ValidationResult> => {
    if (!state.mappedColumns || !workspaceId) {
      return {
        validRows: [],
        errorRows: [],
        duplicatesInFile: [],
        duplicatesInDb: [],
        totalRows: 0,
      };
    }

    const mapping = state.mappedColumns;
    const dataRows = state.rawData.slice(1); // Skip header row
    const errors: ValidationError[] = [];
    const validRows: number[] = [];
    const phonesSeen = new Map<string, number>(); // phone -> first row
    const duplicatesInFile: DuplicateContact[] = [];
    const phonesToCheck: string[] = [];
    const rowPhoneMap = new Map<number, { normalized: string; original: string; with55: string; without55: string }>(); // row -> phones

    // First pass: validate required fields and detect file duplicates
    dataRows.forEach((row, index) => {
      const rowNum = index + 2; // +2 for 1-indexed and header row
      const name = row[mapping.nome]?.trim();
      const phone = row[mapping.telefone]?.trim();
      const normalizedPhone = normalizePhone(phone);
      const originalDigits = phone?.replace(/\D/g, "") || "";

      // Check required fields
      if (!name) {
        errors.push({ row: rowNum, field: "nome", message: "Nome é obrigatório" });
      }
      if (!phone) {
        errors.push({ row: rowNum, field: "telefone", message: "Telefone é obrigatório" });
      }

      // Check for duplicates within file
      if (normalizedPhone) {
        const existingRow = phonesSeen.get(normalizedPhone);
        if (existingRow !== undefined) {
          duplicatesInFile.push({
            row: rowNum,
            phone: phone,
            name: name || "",
            isInFile: true,
          });
        } else {
          phonesSeen.set(normalizedPhone, rowNum);

          // Create all possible phone variants for DB comparison
          // This handles cases where DB might have phone with or without 55 prefix
          const phoneWith55 =
            originalDigits.length >= 10 &&
            originalDigits.length <= 11 &&
            !originalDigits.startsWith("55")
              ? "55" + originalDigits
              : originalDigits;

          const phoneWithout55 =
            originalDigits.startsWith("55") && originalDigits.length >= 12
              ? originalDigits.slice(2)
              : originalDigits;

          // Add all variants to check in DB
          phonesToCheck.push(normalizedPhone);
          if (originalDigits !== normalizedPhone) {
            phonesToCheck.push(originalDigits);
          }
          if (phoneWith55 !== normalizedPhone && phoneWith55 !== originalDigits) {
            phonesToCheck.push(phoneWith55);
          }
          if (phoneWithout55 !== normalizedPhone && phoneWithout55 !== originalDigits) {
            phonesToCheck.push(phoneWithout55);
          }

          rowPhoneMap.set(rowNum, {
            normalized: normalizedPhone,
            original: originalDigits,
            with55: phoneWith55,
            without55: phoneWithout55,
          });
        }
      }

      // If no errors for this row, mark as valid (for now)
      if (name && phone) {
        validRows.push(rowNum);
      }
    });

    // Second pass: check for duplicates in database
    const duplicatesInDb: DuplicateContact[] = [];
    const foundRows = new Set<number>(); // Track rows already found as duplicates

    if (phonesToCheck.length > 0) {
      // Remove duplicates from phonesToCheck array
      const uniquePhones = [...new Set(phonesToCheck)];

      // Query in batches of 100
      const batchSize = 100;
      for (let i = 0; i < uniquePhones.length; i += batchSize) {
        const batch = uniquePhones.slice(i, i + batchSize);

        const { data: existingContacts } = await supabase
          .from("crm_contacts")
          .select("id, phone, name")
          .eq("workspace_id", workspaceId)
          .neq("is_active", false)
          .in("phone", batch);

        if (existingContacts) {
          for (const contact of existingContacts) {
            const dbPhone = contact.phone || "";
            // Find the row that has this phone (check all variants)
            for (const [rowNum, phones] of rowPhoneMap) {
              if (foundRows.has(rowNum)) continue; // Already found this row

              // Compare with all possible phone variants
              if (
                dbPhone === phones.normalized ||
                dbPhone === phones.original ||
                dbPhone === phones.with55 ||
                dbPhone === phones.without55
              ) {
                duplicatesInDb.push({
                  row: rowNum,
                  phone: dbPhone,
                  name: contact.name || "",
                  existingId: contact.id,
                });
                foundRows.add(rowNum);
                break;
              }
            }
          }
        }
      }
    }

    const result: ValidationResult = {
      validRows: validRows.filter(
        (row) =>
          !duplicatesInFile.some((d) => d.row === row) &&
          !errors.some((e) => e.row === row)
      ),
      errorRows: errors,
      duplicatesInFile,
      duplicatesInDb,
      totalRows: dataRows.length,
    };

    setState((prev) => ({ ...prev, validationResult: result }));

    return result;
  }, [state.mappedColumns, state.rawData, workspaceId]);

  /**
   * Starts the import process
   */
  const startImport = useCallback(async (): Promise<void> => {
    if (!state.mappedColumns || !state.validationResult || !workspaceId) {
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({
        title: "Erro de autenticação",
        description: "Usuário não autenticado",
        variant: "destructive",
      });
      return;
    }

    const mapping = state.mappedColumns;
    const validation = state.validationResult;
    const dataRows = state.rawData.slice(1);
    const duplicateAction = state.duplicateAction;
    const commonTag = state.commonTag.trim();

    // Fetch existing workspace tags to preserve their colors
    const { data: existingTagsData } = await supabase
      .from("crm_contacts")
      .select("tags")
      .eq("workspace_id", workspaceId)
      .not("tags", "is", null);

    // Build map of existing tag names to colors
    const existingTagColors = new Map<string, string>();
    existingTagsData?.forEach((contact) => {
      const contactTags = parseTags(contact.tags);
      contactTags.forEach((tag) => {
        // Keep first occurrence of each tag name (preserves original color)
        if (!existingTagColors.has(tag.name.toLowerCase())) {
          existingTagColors.set(tag.name.toLowerCase(), tag.color);
        }
      });
    });

    // Helper to get tag color: use existing color if available, otherwise generate
    const getTagColor = (tagName: string): string => {
      const existingColor = existingTagColors.get(tagName.toLowerCase());
      return existingColor || getDefaultTagColor(tagName);
    };

    // Determine which rows to process
    const rowsToInsert = validation.validRows;
    const rowsToUpdate =
      duplicateAction === "overwrite"
        ? validation.duplicatesInDb.map((d) => d.row)
        : [];

    const allRowsToProcess = [...new Set([...rowsToInsert, ...rowsToUpdate])];

    setState((prev) => ({
      ...prev,
      importProgress: {
        ...initialProgress,
        total: allRowsToProcess.length,
      },
    }));

    setCancelFlag(false);

    const BATCH_SIZE = 50;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < allRowsToProcess.length; i += BATCH_SIZE) {
      // Check for cancellation
      if (cancelFlag) {
        setState((prev) => ({
          ...prev,
          importProgress: {
            ...prev.importProgress,
            isCancelled: true,
            isComplete: true,
          },
        }));
        return;
      }

      const batch = allRowsToProcess.slice(i, i + BATCH_SIZE);

      for (const rowNum of batch) {
        const rowIndex = rowNum - 2; // Convert back to 0-indexed
        const row = dataRows[rowIndex];

        if (!row) {
          errors++;
          continue;
        }

        const name = row[mapping.nome]?.trim();
        const phone = normalizePhone(row[mapping.telefone]?.trim());

        if (!name || !phone) {
          errors++;
          continue;
        }

        // Parse tags from CSV
        let tags: ContactTag[] = [];
        if (mapping.tags >= 0 && row[mapping.tags]) {
          const tagNames = row[mapping.tags].split(",").map((t) => t.trim()).filter(Boolean);
          tags = tagNames.map((tagName) => ({
            name: tagName,
            color: getTagColor(tagName),
          }));
        }

        // Add common tag if specified
        if (commonTag && !tags.some((t) => t.name.toLowerCase() === commonTag.toLowerCase())) {
          tags.push({
            name: commonTag,
            color: getTagColor(commonTag),
          });
        }

        const contactData = {
          workspace_id: workspaceId,
          name,
          phone,
          email: mapping.email >= 0 ? row[mapping.email]?.trim() || null : null,
          company: mapping.empresa >= 0 ? row[mapping.empresa]?.trim() || null : null,
          job_title: mapping.cargo >= 0 ? row[mapping.cargo]?.trim() || null : null,
          position: mapping.posicao >= 0 ? row[mapping.posicao]?.trim() || null : null,
          employee_count: mapping.tamanho_empresa >= 0 ? row[mapping.tamanho_empresa]?.trim() || null : null,
          revenue: mapping.faturamento >= 0 ? row[mapping.faturamento]?.trim() || null : null,
          notes: mapping.observacoes >= 0 ? row[mapping.observacoes]?.trim() || null : null,
          tags: tags.length > 0 ? (tags as unknown as Json) : null,
          source: "importacao",
        };

        // Check if this is an update
        const duplicate = validation.duplicatesInDb.find((d) => d.row === rowNum);

        try {
          if (duplicate && duplicateAction === "overwrite") {
            const { error } = await supabase
              .from("crm_contacts")
              .update(contactData)
              .eq("id", duplicate.existingId);

            if (error) throw error;
            updated++;
          } else if (!duplicate) {
            const { error } = await supabase
              .from("crm_contacts")
              .insert({
                ...contactData,
                created_by: user.id,
              });

            if (error) throw error;
            inserted++;
          } else {
            skipped++;
          }
        } catch (error: any) {
          const msg = error?.message || "";
          if (msg.includes("Contato duplicado")) {
            console.warn(`Import row ${rowNum}: ${msg}`);
          } else {
            console.error("Import row error:", error);
          }
          errors++;
        }
      }

      // Update progress
      setState((prev) => ({
        ...prev,
        importProgress: {
          ...prev.importProgress,
          processed: Math.min(i + BATCH_SIZE, allRowsToProcess.length),
          inserted,
          updated,
          skipped,
          errors,
        },
      }));
    }

    // Mark as complete
    setState((prev) => ({
      ...prev,
      importProgress: {
        ...prev.importProgress,
        processed: allRowsToProcess.length,
        inserted,
        updated,
        skipped,
        errors,
        isComplete: true,
      },
    }));

    // Invalidate queries
    queryClient.invalidateQueries({ queryKey: ["crm-contacts"] });
    queryClient.invalidateQueries({ queryKey: ["crm-contacts-count"] });
    queryClient.invalidateQueries({ queryKey: ["crm-contacts-companies"] });
    queryClient.invalidateQueries({ queryKey: ["workspace-tags"] });

  }, [
    state.mappedColumns,
    state.validationResult,
    state.rawData,
    state.duplicateAction,
    state.commonTag,
    workspaceId,
    cancelFlag,
    queryClient,
    toast,
  ]);

  const cancelImport = useCallback(() => {
    setCancelFlag(true);
  }, []);

  /**
   * Generates and downloads the CSV template
   */
  const downloadTemplate = useCallback(() => {
    const BOM = "\uFEFF";
    const headers = EXPECTED_COLUMNS.join(";");
    const exampleRow = [
      "Joao Silva",
      "11999998888",
      "joao@email.com",
      "Empresa X",
      "Diretor",
      "",
      "",
      "",
      "Lead interessado",
      "cliente,prospect",
    ].join(";");

    const content = BOM + headers + "\n" + exampleRow;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "modelo_importacao_contatos.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  return {
    state,
    reset,
    setStep,
    setMethod,
    setDuplicateAction,
    setCommonTag,
    parseCSVFile,
    validateColumns,
    validateData,
    startImport,
    cancelImport,
    downloadTemplate,
  };
}
