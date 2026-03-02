import { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs';
import { OTLPGRPCExporterConfigNode, OTLPGRPCExporterNodeBase, ServiceClientType } from '@opentelemetry/otlp-grpc-exporter-base';
import { IExportLogsServiceRequest } from '@opentelemetry/otlp-transformer';
/**
 * OTLP Logs Exporter for Node
 */
export declare class OTLPLogExporter extends OTLPGRPCExporterNodeBase<ReadableLogRecord, IExportLogsServiceRequest> implements LogRecordExporter {
    constructor(config?: OTLPGRPCExporterConfigNode);
    convert(logRecords: ReadableLogRecord[]): IExportLogsServiceRequest;
    getDefaultUrl(config: OTLPGRPCExporterConfigNode): string;
    getServiceClientType(): ServiceClientType;
    getServiceProtoPath(): string;
    getUrlFromConfig(config: OTLPGRPCExporterConfigNode): string;
}
//# sourceMappingURL=OTLPLogExporter.d.ts.map