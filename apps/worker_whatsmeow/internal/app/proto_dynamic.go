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
	workerConnectionService           protoreflect.ServiceDescriptor
	statusConnectionRequest           protoreflect.MessageDescriptor
	workerConnectionResponse          protoreflect.MessageDescriptor
	connectionPhoneValidationRequest  protoreflect.MessageDescriptor
	connectionPhoneValidationResponse protoreflect.MessageDescriptor

	commandNotifyWorkerStatus       protoreflect.MessageDescriptor
	commandResponse                 protoreflect.MessageDescriptor
	commandResolveIncomingCallReq   protoreflect.MessageDescriptor
	commandResolveIncomingCallResp  protoreflect.MessageDescriptor
	commandTypingSimulationReq      protoreflect.MessageDescriptor
	commandTypingSimulationResp     protoreflect.MessageDescriptor
	commandRegisterS3BackupFallback protoreflect.MessageDescriptor
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
			message("StatusConnectionRequest",
				stringField("worker_id", 1),
				stringField("status", 2),
				stringField("type", 3),
				stringField("phone_connection", 4),
				boolField("remove_session", 5),
				stringField("connection_attempt_id", 6),
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
		},
		Service: []*descriptorpb.ServiceDescriptorProto{{
			Name: proto.String("WorkerConnection"),
			Method: []*descriptorpb.MethodDescriptorProto{
				method("RequestConnection", ".worker_connection.StatusConnectionRequest", ".worker_connection.WorkerConnectionResponse"),
				method("ValidatePhone", ".worker_connection.PhoneValidationRequest", ".worker_connection.PhoneValidationResponse"),
			},
		}},
	}, nil)
	if err != nil {
		return dynamicDescriptors{}, err
	}

	commandFile, err := protodesc.NewFile(&descriptorpb.FileDescriptorProto{
		Syntax:  proto.String("proto3"),
		Name:    proto.String("worker_command.proto"),
		Package: proto.String("worker_command"),
		MessageType: []*descriptorpb.DescriptorProto{
			message("WorkerCommandResponse"),
			message("NotifyWorkerStatusRequest",
				stringField("worker_id", 1),
				stringField("account_id", 2),
				stringField("worker_status_id", 3),
				stringField("phone", 4),
				boolField("disconnected_user", 5),
			),
			message("ResolveIncomingCallActionRequest",
				stringField("worker_id", 1),
				stringField("account_id", 2),
				stringField("call_jid", 3),
				stringField("call_phone", 4),
				boolField("is_video", 5),
			),
			message("ResolveIncomingCallActionResponse",
				boolField("reject_call", 1),
				boolField("show_message_on_call", 2),
				stringField("show_message_text", 3),
			),
			message("GetTypingSimulationConfigRequest",
				stringField("worker_id", 1),
				stringField("account_id", 2),
			),
			message("GetTypingSimulationConfigResponse",
				boolField("enabled", 1),
				int32Field("speed", 2),
			),
			message("RegisterS3BackupFallbackUploadRequest",
				stringField("account_id", 1),
				stringField("bucket", 2),
				stringField("object_key", 3),
				stringField("file_name", 4),
				stringField("content_type", 5),
				int64Field("size_bytes", 6),
				int32Field("primary_attempts", 7),
				int32Field("backup_attempts", 8),
				stringField("primary_error", 9),
				stringField("backup_error", 10),
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
		},
		Service: []*descriptorpb.ServiceDescriptorProto{{
			Name: proto.String("WorkerCommand"),
			Method: []*descriptorpb.MethodDescriptorProto{
				method("NotifyWorkerStatus", ".worker_command.NotifyWorkerStatusRequest", ".worker_command.WorkerCommandResponse"),
				method("ResolveIncomingCallAction", ".worker_command.ResolveIncomingCallActionRequest", ".worker_command.ResolveIncomingCallActionResponse"),
				method("GetTypingSimulationConfig", ".worker_command.GetTypingSimulationConfigRequest", ".worker_command.GetTypingSimulationConfigResponse"),
				method("RegisterS3BackupFallbackUpload", ".worker_command.RegisterS3BackupFallbackUploadRequest", ".worker_command.WorkerCommandResponse"),
			},
		}},
	}, nil)
	if err != nil {
		return dynamicDescriptors{}, err
	}

	return dynamicDescriptors{
		workerConnectionService:           connectionFile.Services().ByName("WorkerConnection"),
		statusConnectionRequest:           connectionFile.Messages().ByName("StatusConnectionRequest"),
		workerConnectionResponse:          connectionFile.Messages().ByName("WorkerConnectionResponse"),
		connectionPhoneValidationRequest:  connectionFile.Messages().ByName("PhoneValidationRequest"),
		connectionPhoneValidationResponse: connectionFile.Messages().ByName("PhoneValidationResponse"),
		commandNotifyWorkerStatus:         commandFile.Messages().ByName("NotifyWorkerStatusRequest"),
		commandResponse:                   commandFile.Messages().ByName("WorkerCommandResponse"),
		commandResolveIncomingCallReq:     commandFile.Messages().ByName("ResolveIncomingCallActionRequest"),
		commandResolveIncomingCallResp:    commandFile.Messages().ByName("ResolveIncomingCallActionResponse"),
		commandTypingSimulationReq:        commandFile.Messages().ByName("GetTypingSimulationConfigRequest"),
		commandTypingSimulationResp:       commandFile.Messages().ByName("GetTypingSimulationConfigResponse"),
		commandRegisterS3BackupFallback:   commandFile.Messages().ByName("RegisterS3BackupFallbackUploadRequest"),
	}, nil
}

func message(name string, fields ...*descriptorpb.FieldDescriptorProto) *descriptorpb.DescriptorProto {
	return &descriptorpb.DescriptorProto{
		Name:  proto.String(name),
		Field: fields,
	}
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

func requiredDescriptor(desc protoreflect.MessageDescriptor, name string) (protoreflect.MessageDescriptor, error) {
	if desc == nil {
		return nil, fmt.Errorf("missing protobuf descriptor %s", name)
	}
	return desc, nil
}
