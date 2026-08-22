package app

import (
	"fmt"
	"sync"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/dynamicpb"
)

type dynamicDescriptors struct {
	workerConnectionService                protoreflect.ServiceDescriptor
	statusConnectionRequest                protoreflect.MessageDescriptor
	workerConnectionResponse               protoreflect.MessageDescriptor
	passkeyResponseRequest                 protoreflect.MessageDescriptor
	passkeyConfirmationRequest             protoreflect.MessageDescriptor
	secureSessionImportRequest             protoreflect.MessageDescriptor
	providerHandoffPrepareRequest          protoreflect.MessageDescriptor
	providerHandoffPrepareResponse         protoreflect.MessageDescriptor
	sessionStorageMigrationPrepareRequest  protoreflect.MessageDescriptor
	sessionStorageMigrationPrepareResponse protoreflect.MessageDescriptor
	connectionPhoneValidationRequest       protoreflect.MessageDescriptor
	connectionPhoneValidationResponse      protoreflect.MessageDescriptor
	workerRuntimeActivationRequest         protoreflect.MessageDescriptor
	workerRuntimeActivationResponse        protoreflect.MessageDescriptor
	workerRuntimeHealthRequest             protoreflect.MessageDescriptor
	workerRuntimeHealthResponse            protoreflect.MessageDescriptor
}

var (
	descriptorsOnce sync.Once
	descriptors     dynamicDescriptors
	descriptorsErr  error
)

func getDescriptors() (dynamicDescriptors, error) {
	descriptorsOnce.Do(func() {
		descriptors, descriptorsErr = buildDynamicDescriptors()
	})
	return descriptors, descriptorsErr
}

func buildDynamicDescriptors() (dynamicDescriptors, error) {
	connectionFile, err := protodesc.NewFile(&descriptorpb.FileDescriptorProto{
		Syntax:  proto.String("proto3"),
		Name:    proto.String("worker_connection.proto"),
		Package: proto.String("worker_connection"),
		MessageType: []*descriptorpb.DescriptorProto{
			whatsappConnectionStatusMessage(),
			message("StatusConnectionRequest",
				stringField("worker_id", 1),
				stringField("status", 2),
				stringField("type", 3),
				stringField("phone_connection", 4),
				boolField("remove_session", 5),
				stringField("connection_attempt_id", 6),
				int32Field("runtime_generation", 9),
				stringField("warm_pool_id", 10),
				stringField("debug_trace_id", 11),
				boolField("qr_pending", 12),
				stringField("authorized_connection_epoch", 13),
			),
			message("WorkerConnectionResponse",
				int32Field("code", 1),
				stringField("status", 2),
				stringField("worker_id", 3),
				stringField("account_id", 4),
				stringField("qrcode", 5),
				boolField("is_new_login", 6),
				int64Field("time", 7),
				stringField("phone", 8),
				boolField("disconnected_user", 9),
				stringField("pairing_code", 10),
				int32Field("seconds_until_next_attempt", 11),
				stringField("worker_status_id", 12),
				int32Field("attempt", 13),
				int32Field("max_attempts", 14),
				stringField("connection_attempt_id", 15),
				boolField("qr_pending", 16),
				stringField("proxy_status", 17),
				stringField("proxy_error_code", 18),
				stringField("proxy_fallback", 19),
				boolField("proxy_bypassed", 20),
				stringField("qr_generated_at", 21),
				stringField("reason", 23),
				stringField("error", 24),
				int32Field("time_to_first_qr_ms", 25),
				stringField("container_id", 26),
				int32Field("runtime_generation", 27),
				stringField("warm_pool_id", 28),
				stringField("worker_type_id", 29),
				stringField("expires_at", 30),
				stringField("debug_trace_id", 31),
				boolField("session_ready", 32),
				boolField("can_send", 33),
				boolField("can_receive_runtime", 34),
				boolField("authenticated", 35),
				stringField("provider_state", 36),
				stringField("degraded_reason", 37),
				stringField("last_probe_at", 38),
				int32Field("probe_latency_ms", 39),
				stringField("passkey_public_key", 40),
				boolField("passkey_pending", 41),
				stringField("passkey_confirmation_code", 42),
				boolField("passkey_skip_handoff_ux", 43),
				messageField("connection_status", 44, ".worker_connection.WhatsappConnectionStatus"),
				stringField("connection_status_source_id", 45),
				stringField("authorized_connection_epoch", 46),
			),
			message("PasskeyResponseRequest",
				stringField("worker_id", 1),
				stringField("account_id", 2),
				stringField("connection_attempt_id", 3),
				stringField("passkey_response", 4),
				stringField("debug_trace_id", 5),
			),
			message("PasskeyConfirmationRequest",
				stringField("worker_id", 1),
				stringField("account_id", 2),
				stringField("connection_attempt_id", 3),
				stringField("debug_trace_id", 4),
			),
			message("SecureSessionImportRequest",
				stringField("worker_id", 1),
				stringField("account_id", 2),
				stringField("worker_type_id", 3),
				stringField("connection_attempt_id", 4),
				int32Field("runtime_generation", 5),
				stringField("format_version", 6),
				stringField("source", 7),
				stringField("target_provider", 8),
				stringField("payload_ref", 9),
				stringField("payload_json", 10),
				stringField("checksum", 11),
				stringField("debug_trace_id", 12),
			),
			message("ProviderHandoffPrepareRequest",
				stringField("worker_id", 1),
				stringField("account_id", 2),
				stringField("handoff_id", 3),
				stringField("lifecycle_operation_id", 4),
				stringField("source_provider", 5),
				stringField("target_provider", 6),
				int64Field("source_revision_id", 7),
				int32Field("runtime_generation", 8),
				stringField("debug_trace_id", 9),
			),
			message("ProviderHandoffPrepareResponse",
				stringField("worker_id", 1),
				stringField("provider", 2),
				stringField("handoff_id", 3),
				stringField("lifecycle_operation_id", 4),
				int64Field("source_revision_id", 5),
				int32Field("runtime_generation", 6),
				boolField("prepared", 7),
				boolField("consumers_drained", 8),
				boolField("writes_paused", 9),
				boolField("checkpoint_persisted", 10),
				boolField("provider_disconnected", 11),
				boolField("lease_released", 12),
				stringField("checkpoint_checksum_sha256", 13),
				int64Field("checkpoint_size_bytes", 14),
				int64Field("checkpoint_record_count", 15),
				stringField("prepared_at", 16),
				stringField("error", 17),
			),
			message("SessionStorageMigrationPrepareRequest",
				stringField("worker_id", 1),
				stringField("account_id", 2),
				stringField("migration_id", 3),
				stringField("provider", 4),
				stringField("source_volume_name", 5),
				int32Field("runtime_generation", 6),
				stringField("expected_phone", 7),
				stringField("debug_trace_id", 8),
				stringField("runtime_capability", 9),
			),
			message("SessionStorageMigrationPrepareResponse",
				stringField("worker_id", 1),
				stringField("provider", 2),
				stringField("migration_id", 3),
				int32Field("runtime_generation", 4),
				boolField("prepared", 5),
				boolField("consumers_drained", 6),
				boolField("writes_paused", 7),
				boolField("checkpoint_persisted", 8),
				boolField("provider_disconnected", 9),
				stringField("checkpoint_checksum_sha256", 10),
				int64Field("checkpoint_size_bytes", 11),
				int64Field("checkpoint_record_count", 12),
				stringField("phone", 13),
				stringField("identity_hash", 14),
				stringField("prepared_at", 15),
				stringField("error", 16),
				boolField("volume_preserved", 17),
			),
			message("PhoneValidationRequest",
				stringField("request_id", 1),
				stringField("account_id", 2),
				stringField("worker_id", 3),
				stringField("phone", 4),
				stringField("phone_ddi", 5),
			),
			message("PhoneValidationResponse",
				stringField("request_id", 1),
				stringField("account_id", 2),
				stringField("worker_id", 3),
				boolField("valid", 4),
				stringField("jid", 5),
				stringField("phone", 6),
				stringField("error", 7),
			),
			message("WorkerRuntimeActivationRequest",
				stringField("worker_id", 1),
				stringField("account_id", 2),
				stringField("worker_type_id", 3),
				stringField("warm_pool_id", 4),
				stringField("session_volume_name", 5),
				stringField("balancer_grpc_host", 6),
				int32Field("balancer_grpc_port", 7),
				int32Field("runtime_generation", 9),
				stringField("session_storage", 10),
				stringField("runtime_capability", 11),
				stringField("writer_epoch", 12),
			),
			message("WorkerRuntimeActivationResponse",
				stringField("worker_id", 1),
				stringField("account_id", 2),
				boolField("activated", 3),
				boolField("already_active", 4),
				stringField("error", 5),
			),
			message("WorkerRuntimeHealthRequest",
				stringField("worker_id", 1),
				stringField("warm_pool_id", 2),
			),
			message("WorkerRuntimeHealthResponse",
				stringField("worker_id", 1),
				stringField("account_id", 2),
				stringField("warm_pool_id", 3),
				boolField("standby", 4),
				boolField("activated", 5),
				boolField("ready", 6),
				boolField("has_session", 7),
				boolField("has_qr", 8),
				stringField("error", 9),
				stringField("worker_type_id", 10),
				int32Field("runtime_generation", 11),
				stringField("runtime_state", 12),
				boolField("qr_stream_ready", 13),
				boolField("session_ready", 14),
				boolField("can_send", 15),
				boolField("can_receive_runtime", 16),
				boolField("authenticated", 17),
				stringField("provider_state", 18),
				stringField("degraded_reason", 19),
				stringField("last_probe_at", 20),
				int32Field("probe_latency_ms", 21),
				stringField("phone", 22),
				boolField("kafka_unhealthy", 23),
				boolField("kafka_consumers_ready", 24),
				boolField("kafka_consumers_authorized", 25),
				uint32Field("runtime_health_schema_version", 26),
				messageField("connection_status", 27, ".worker_connection.WhatsappConnectionStatus"),
				stringField("connection_status_source_id", 28),
				boolField("command_ingress_ready", 29),
				boolField("command_ingress_authorized", 30),
				stringField("session_storage", 31),
				int64Field("session_revision_id", 32),
				stringField("session_storage_migration_id", 33),
			),
		},
		Service: []*descriptorpb.ServiceDescriptorProto{{
			Name: proto.String("WorkerConnection"),
			Method: []*descriptorpb.MethodDescriptorProto{
				method("RequestConnection", ".worker_connection.StatusConnectionRequest", ".worker_connection.WorkerConnectionResponse"),
				method("SendPasskeyResponse", ".worker_connection.PasskeyResponseRequest", ".worker_connection.WorkerConnectionResponse"),
				method("ConfirmPasskey", ".worker_connection.PasskeyConfirmationRequest", ".worker_connection.WorkerConnectionResponse"),
				method("ImportSecureSession", ".worker_connection.SecureSessionImportRequest", ".worker_connection.WorkerConnectionResponse"),
				method("ValidatePhone", ".worker_connection.PhoneValidationRequest", ".worker_connection.PhoneValidationResponse"),
				method("ActivateRuntime", ".worker_connection.WorkerRuntimeActivationRequest", ".worker_connection.WorkerRuntimeActivationResponse"),
				method("RuntimeHealth", ".worker_connection.WorkerRuntimeHealthRequest", ".worker_connection.WorkerRuntimeHealthResponse"),
				method("PrepareProviderHandoff", ".worker_connection.ProviderHandoffPrepareRequest", ".worker_connection.ProviderHandoffPrepareResponse"),
				method("PrepareSessionStorageMigration", ".worker_connection.SessionStorageMigrationPrepareRequest", ".worker_connection.SessionStorageMigrationPrepareResponse"),
			},
		}},
	}, nil)
	if err != nil {
		return dynamicDescriptors{}, err
	}

	return dynamicDescriptors{
		workerConnectionService:                connectionFile.Services().ByName("WorkerConnection"),
		statusConnectionRequest:                connectionFile.Messages().ByName("StatusConnectionRequest"),
		workerConnectionResponse:               connectionFile.Messages().ByName("WorkerConnectionResponse"),
		passkeyResponseRequest:                 connectionFile.Messages().ByName("PasskeyResponseRequest"),
		passkeyConfirmationRequest:             connectionFile.Messages().ByName("PasskeyConfirmationRequest"),
		secureSessionImportRequest:             connectionFile.Messages().ByName("SecureSessionImportRequest"),
		providerHandoffPrepareRequest:          connectionFile.Messages().ByName("ProviderHandoffPrepareRequest"),
		providerHandoffPrepareResponse:         connectionFile.Messages().ByName("ProviderHandoffPrepareResponse"),
		sessionStorageMigrationPrepareRequest:  connectionFile.Messages().ByName("SessionStorageMigrationPrepareRequest"),
		sessionStorageMigrationPrepareResponse: connectionFile.Messages().ByName("SessionStorageMigrationPrepareResponse"),
		connectionPhoneValidationRequest:       connectionFile.Messages().ByName("PhoneValidationRequest"),
		connectionPhoneValidationResponse:      connectionFile.Messages().ByName("PhoneValidationResponse"),
		workerRuntimeActivationRequest:         connectionFile.Messages().ByName("WorkerRuntimeActivationRequest"),
		workerRuntimeActivationResponse:        connectionFile.Messages().ByName("WorkerRuntimeActivationResponse"),
		workerRuntimeHealthRequest:             connectionFile.Messages().ByName("WorkerRuntimeHealthRequest"),
		workerRuntimeHealthResponse:            connectionFile.Messages().ByName("WorkerRuntimeHealthResponse"),
	}, nil
}

func message(name string, fields ...*descriptorpb.FieldDescriptorProto) *descriptorpb.DescriptorProto {
	return &descriptorpb.DescriptorProto{
		Name:  proto.String(name),
		Field: fields,
	}
}

func whatsappConnectionStatusMessage() *descriptorpb.DescriptorProto {
	sessionValid := boolField("sessionValid", 5)
	sessionValid.Proto3Optional = proto.Bool(true)
	sessionValid.OneofIndex = proto.Int32(0)
	result := message("WhatsappConnectionStatus",
		stringField("provider", 1),
		stringField("status", 2),
		boolField("connected", 3),
		boolField("authenticated", 4),
		sessionValid,
		boolField("recoverable", 6),
		boolField("qrAvailable", 7),
		uint64Field("sequence", 8),
		stringField("changedAt", 9),
		stringField("reason", 10),
		stringField("errorCode", 11),
	)
	result.OneofDecl = []*descriptorpb.OneofDescriptorProto{{
		Name: proto.String("_sessionValid"),
	}}
	return result
}

func method(name, input, output string) *descriptorpb.MethodDescriptorProto {
	return &descriptorpb.MethodDescriptorProto{
		Name:       proto.String(name),
		InputType:  proto.String(input),
		OutputType: proto.String(output),
	}
}

func stringField(name string, number int32) *descriptorpb.FieldDescriptorProto {
	return field(name, number, descriptorpb.FieldDescriptorProto_TYPE_STRING)
}

func boolField(name string, number int32) *descriptorpb.FieldDescriptorProto {
	return field(name, number, descriptorpb.FieldDescriptorProto_TYPE_BOOL)
}

func int64Field(name string, number int32) *descriptorpb.FieldDescriptorProto {
	return field(name, number, descriptorpb.FieldDescriptorProto_TYPE_INT64)
}

func int32Field(name string, number int32) *descriptorpb.FieldDescriptorProto {
	return field(name, number, descriptorpb.FieldDescriptorProto_TYPE_INT32)
}

func uint32Field(name string, number int32) *descriptorpb.FieldDescriptorProto {
	return field(name, number, descriptorpb.FieldDescriptorProto_TYPE_UINT32)
}

func uint64Field(name string, number int32) *descriptorpb.FieldDescriptorProto {
	return field(name, number, descriptorpb.FieldDescriptorProto_TYPE_UINT64)
}

func messageField(name string, number int32, typeName string) *descriptorpb.FieldDescriptorProto {
	result := field(name, number, descriptorpb.FieldDescriptorProto_TYPE_MESSAGE)
	result.TypeName = proto.String(typeName)
	return result
}

func field(name string, number int32, typ descriptorpb.FieldDescriptorProto_Type) *descriptorpb.FieldDescriptorProto {
	return &descriptorpb.FieldDescriptorProto{
		Name:   proto.String(name),
		Number: proto.Int32(number),
		Label:  descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
		Type:   typ.Enum(),
	}
}

func newDynamicMessage(desc protoreflect.MessageDescriptor) *dynamicpb.Message {
	return dynamicpb.NewMessage(desc)
}

func dynamicString(msg *dynamicpb.Message, name string) string {
	field := msg.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field == nil {
		return ""
	}
	return msg.Get(field).String()
}

func dynamicBool(msg *dynamicpb.Message, name string) bool {
	field := msg.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field == nil {
		return false
	}
	return msg.Get(field).Bool()
}

func dynamicInt32(msg *dynamicpb.Message, name string) int32 {
	field := msg.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field == nil {
		return 0
	}
	return int32(msg.Get(field).Int())
}

func dynamicInt64(msg *dynamicpb.Message, name string) int64 {
	field := msg.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field == nil {
		return 0
	}
	return msg.Get(field).Int()
}

func setDynamicString(msg *dynamicpb.Message, name, value string) {
	if value == "" {
		return
	}
	field := msg.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field != nil {
		msg.Set(field, protoreflect.ValueOfString(value))
	}
}

func setDynamicBool(msg *dynamicpb.Message, name string, value bool) {
	field := msg.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field != nil {
		msg.Set(field, protoreflect.ValueOfBool(value))
	}
}

func setDynamicInt64(msg *dynamicpb.Message, name string, value int64) {
	field := msg.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field != nil {
		msg.Set(field, protoreflect.ValueOfInt64(value))
	}
}

func setDynamicInt32(msg *dynamicpb.Message, name string, value int32) {
	field := msg.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field != nil {
		msg.Set(field, protoreflect.ValueOfInt32(value))
	}
}

func setDynamicUint32(msg *dynamicpb.Message, name string, value uint32) {
	field := msg.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field != nil {
		msg.Set(field, protoreflect.ValueOfUint32(value))
	}
}

func setDynamicUint64(msg *dynamicpb.Message, name string, value uint64) {
	field := msg.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field != nil {
		msg.Set(field, protoreflect.ValueOfUint64(value))
	}
}

func setDynamicConnectionStatus(msg *dynamicpb.Message, name string, value *WhatsappConnectionStatus) {
	if value == nil {
		return
	}
	field := msg.Descriptor().Fields().ByName(protoreflect.Name(name))
	if field == nil || field.Message() == nil {
		return
	}
	nested := newDynamicMessage(field.Message())
	setDynamicString(nested, "provider", value.Provider)
	setDynamicString(nested, "status", value.Status)
	setDynamicBool(nested, "connected", value.Connected)
	setDynamicBool(nested, "authenticated", value.Authenticated)
	if value.SessionValid != nil {
		setDynamicBool(nested, "sessionValid", *value.SessionValid)
	}
	setDynamicBool(nested, "recoverable", value.Recoverable)
	setDynamicBool(nested, "qrAvailable", value.QRAvailable)
	setDynamicUint64(nested, "sequence", value.Sequence)
	setDynamicString(nested, "changedAt", value.ChangedAt)
	setDynamicString(nested, "reason", value.Reason)
	setDynamicString(nested, "errorCode", value.ErrorCode)
	msg.Set(field, protoreflect.ValueOfMessage(nested))
}

func requiredDescriptor(desc protoreflect.MessageDescriptor, name string) (protoreflect.MessageDescriptor, error) {
	if desc == nil {
		return nil, fmt.Errorf("missing protobuf descriptor %s", name)
	}
	return desc, nil
}
