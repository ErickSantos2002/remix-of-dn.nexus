import React, { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Send, Loader2, CheckCircle, XCircle, FlaskConical } from 'lucide-react';

interface TestResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

interface ZapiTestPanelProps {
  connectionId?: string;
}

export function ZapiTestPanel({ connectionId }: ZapiTestPanelProps) {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const handleTest = async () => {
    if (!phone || !message) {
      setResult({
        success: false,
        message: 'Por favor, preencha telefone e mensagem',
      });
      return;
    }

    if (!connectionId) {
      setResult({
        success: false,
        message: 'Nenhuma conexao Z-API selecionada',
      });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      console.log('[ZAPI-TEST] Sending test message:', { phone, message, connectionId });

      const { data, error } = await supabase.functions.invoke('zapi-send', {
        body: {
          connection_id: connectionId,
          phone: phone.replace(/\D/g, ''), // Remove non-digits
          message,
        },
      });

      console.log('[ZAPI-TEST] Response:', { data, error });

      if (error) {
        setResult({
          success: false,
          message: 'Erro ao enviar mensagem',
          error: error.message,
        });
      } else {
        setResult({
          success: true,
          message: 'Mensagem enviada com sucesso!',
          data,
        });
      }
    } catch (err) {
      console.error('[ZAPI-TEST] Error:', err);
      setResult({
        success: false,
        message: 'Erro ao enviar mensagem',
        error: err instanceof Error ? err.message : 'Erro desconhecido',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <FlaskConical className="h-5 w-5 text-primary" />
          Testar Envio Z-API
        </CardTitle>
        <CardDescription>
          Envie uma mensagem de teste para verificar se a integracao esta funcionando
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="test-phone">Telefone (formato: 5511999999999)</Label>
          <Input
            id="test-phone"
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="5511999999999"
            className="font-mono"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="test-message">Mensagem</Label>
          <Textarea
            id="test-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Digite sua mensagem de teste..."
            rows={3}
          />
        </div>

        <Button
          onClick={handleTest}
          disabled={loading || !connectionId}
          className="w-full"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Enviando...
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Enviar Teste
            </>
          )}
        </Button>

        {!connectionId && (
          <p className="text-sm text-muted-foreground text-center">
            Selecione uma conexao Z-API ativa para testar
          </p>
        )}

        {result && (
          <div
            className={`p-4 rounded-lg border ${
              result.success
                ? 'bg-success/10 border-success/30 text-success'
                : 'bg-destructive/10 border-destructive/30 text-destructive'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              {result.success ? (
                <CheckCircle className="h-5 w-5" />
              ) : (
                <XCircle className="h-5 w-5" />
              )}
              <span className="font-semibold">{result.message}</span>
            </div>
            {(result.data || result.error) && (
              <pre className="text-xs overflow-auto mt-2 p-2 bg-background/50 rounded">
                {JSON.stringify(result.data || { error: result.error }, null, 2)}
              </pre>
            )}
          </div>
        )}

        <div className="p-3 bg-muted/30 rounded-lg text-xs text-muted-foreground">
          <p className="font-semibold mb-1">Instrucoes:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Preencha o numero com codigo do pais (ex: 5511999999999)</li>
            <li>Digite uma mensagem de teste</li>
            <li>Clique em "Enviar Teste"</li>
            <li>Verifique se a mensagem chegou no WhatsApp</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
