#include "FilmGameRuntimeSubsystem.h"

#include "FilmGameRuntimeSettings.h"
#include "Dom/JsonObject.h"
#include "HAL/FileManager.h"
#include "JsonObjectConverter.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "WebSocketsModule.h"
#include "IWebSocket.h"

void UFilmGameRuntimeSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);
    FWebSocketsModule::Get();

    const UFilmGameRuntimeSettings* Settings = GetDefault<UFilmGameRuntimeSettings>();
    if (!Settings->RuntimePackagePath.IsEmpty())
    {
        LoadRuntimePackage(Settings->RuntimePackagePath);
    }
}

void UFilmGameRuntimeSubsystem::Deinitialize()
{
    Disconnect();
    Super::Deinitialize();
}

bool UFilmGameRuntimeSubsystem::LoadRuntimePackage(const FString& PackagePath)
{
    const FString ResolvedPath = FPaths::IsRelative(PackagePath)
        ? FPaths::ConvertRelativePathToFull(FPaths::ProjectDir(), PackagePath)
        : PackagePath;
    FString Json;
    if (!FFileHelper::LoadFileToString(Json, *ResolvedPath))
    {
        OnRuntimeError.Broadcast(TEXT("RUNTIME_PACKAGE_NOT_FOUND"), ResolvedPath);
        return false;
    }

    FFilmGameRuntimePackageHeader Parsed;
    if (!FJsonObjectConverter::JsonObjectStringToUStruct(Json, &Parsed, 0, 0))
    {
        OnRuntimeError.Broadcast(TEXT("INVALID_RUNTIME_PACKAGE"), TEXT("Unable to parse Runtime Package header"));
        return false;
    }
    if (Parsed.SchemaVersion != TEXT("1.0.0") || Parsed.ProjectId.IsEmpty() || Parsed.RuntimeVersion < 1)
    {
        OnRuntimeError.Broadcast(TEXT("UNSUPPORTED_RUNTIME_PACKAGE"), Parsed.SchemaVersion);
        return false;
    }
    RuntimePackage = MoveTemp(Parsed);
    return true;
}

void UFilmGameRuntimeSubsystem::Connect(const FString& AuthToken, const FString& RequestedRoleId, const FString& RoomId)
{
    if (IsConnected())
    {
        OnRuntimeError.Broadcast(TEXT("ALREADY_CONNECTED"), TEXT("Disconnect before joining another room"));
        return;
    }
    if (RuntimePackage.ProjectId.IsEmpty())
    {
        OnRuntimeError.Broadcast(TEXT("RUNTIME_PACKAGE_REQUIRED"), TEXT("Load a Runtime Package before connecting"));
        return;
    }

    const UFilmGameRuntimeSettings* Settings = GetDefault<UFilmGameRuntimeSettings>();
    if (Settings->RuntimeGatewayUrl.IsEmpty())
    {
        OnRuntimeError.Broadcast(TEXT("GATEWAY_NOT_CONFIGURED"), TEXT("RuntimeGatewayUrl is empty"));
        return;
    }

    PendingAuthToken = AuthToken;
    PendingRoleId = RequestedRoleId;
    PendingRoomId = RoomId;
    Socket = FWebSocketsModule::Get().CreateWebSocket(Settings->RuntimeGatewayUrl);
    Socket->OnConnected().AddUObject(this, &UFilmGameRuntimeSubsystem::HandleConnected);
    Socket->OnConnectionError().AddUObject(this, &UFilmGameRuntimeSubsystem::HandleConnectionError);
    Socket->OnClosed().AddUObject(this, &UFilmGameRuntimeSubsystem::HandleClosed);
    Socket->OnMessage().AddUObject(this, &UFilmGameRuntimeSubsystem::HandleMessage);
    Socket->Connect();
}

void UFilmGameRuntimeSubsystem::Disconnect()
{
    if (Socket.IsValid())
    {
        Socket->Close(1000, TEXT("Client disconnect"));
        Socket.Reset();
    }
}

void UFilmGameRuntimeSubsystem::SetReady(bool bReady)
{
    TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
    Payload->SetBoolField(TEXT("ready"), bReady);
    SendEnvelope(TEXT("ready"), Payload);
}

void UFilmGameRuntimeSubsystem::FillOpenSeatsWithBots()
{
    SendEnvelope(TEXT("bots.fill"), MakeShared<FJsonObject>());
}

void UFilmGameRuntimeSubsystem::SubmitAction(const FString& ActionId, const FString& TargetId, const FString& Text)
{
    TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
    Payload->SetStringField(TEXT("actionId"), ActionId);
    if (!TargetId.IsEmpty()) Payload->SetStringField(TEXT("targetId"), TargetId);
    if (!Text.IsEmpty()) Payload->SetStringField(TEXT("text"), Text);
    SendEnvelope(TEXT("intent.submit"), Payload);
}

bool UFilmGameRuntimeSubsystem::IsConnected() const
{
    return Socket.IsValid() && Socket->IsConnected();
}

void UFilmGameRuntimeSubsystem::HandleConnected()
{
    OnConnectionChanged.Broadcast(true, TEXT("Gateway connected"));
    SendJoin();
}

void UFilmGameRuntimeSubsystem::HandleConnectionError(const FString& Error)
{
    OnConnectionChanged.Broadcast(false, Error);
    OnRuntimeError.Broadcast(TEXT("GATEWAY_CONNECTION_ERROR"), Error);
}

void UFilmGameRuntimeSubsystem::HandleClosed(int32 StatusCode, const FString& Reason, bool bWasClean)
{
    OnConnectionChanged.Broadcast(false, FString::Printf(TEXT("%d: %s"), StatusCode, *Reason));
    Socket.Reset();
}

void UFilmGameRuntimeSubsystem::HandleMessage(const FString& Message)
{
    TSharedPtr<FJsonObject> Envelope;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Message);
    if (!FJsonSerializer::Deserialize(Reader, Envelope) || !Envelope.IsValid())
    {
        OnRuntimeError.Broadcast(TEXT("INVALID_GATEWAY_MESSAGE"), TEXT("Message is not valid JSON"));
        return;
    }

    FString Type;
    if (!Envelope->TryGetStringField(TEXT("type"), Type)) return;
    const TSharedPtr<FJsonObject>* Payload = nullptr;
    if (!Envelope->TryGetObjectField(TEXT("payload"), Payload) || Payload == nullptr) return;

    if (Type == TEXT("runtime.snapshot"))
    {
        if (FJsonObjectConverter::JsonObjectToUStruct(Payload->ToSharedRef(), &Snapshot, 0, 0))
        {
            OnSnapshotReceived.Broadcast(Snapshot);
        }
    }
    else if (Type == TEXT("private.state"))
    {
        if (FJsonObjectConverter::JsonObjectToUStruct(Payload->ToSharedRef(), &PrivateState, 0, 0))
        {
            OnPrivateStateReceived.Broadcast(PrivateState);
        }
    }
    else if (Type == TEXT("error"))
    {
        FString Code;
        FString ErrorMessage;
        (*Payload)->TryGetStringField(TEXT("code"), Code);
        (*Payload)->TryGetStringField(TEXT("message"), ErrorMessage);
        OnRuntimeError.Broadcast(Code, ErrorMessage);
    }
}

void UFilmGameRuntimeSubsystem::SendEnvelope(const FString& Type, const TSharedRef<FJsonObject>& Payload)
{
    if (!IsConnected())
    {
        OnRuntimeError.Broadcast(TEXT("NOT_CONNECTED"), TEXT("Runtime Gateway is not connected"));
        return;
    }
    TSharedRef<FJsonObject> Envelope = MakeShared<FJsonObject>();
    Envelope->SetStringField(TEXT("type"), Type);
    Envelope->SetStringField(TEXT("requestId"), FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphensLower));
    Envelope->SetObjectField(TEXT("payload"), Payload);
    FString Serialized;
    const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Serialized);
    FJsonSerializer::Serialize(Envelope, Writer);
    Socket->Send(Serialized);
}

void UFilmGameRuntimeSubsystem::SendJoin()
{
    TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
    Payload->SetStringField(TEXT("projectId"), RuntimePackage.ProjectId);
    Payload->SetNumberField(TEXT("runtimeVersion"), RuntimePackage.RuntimeVersion);
    Payload->SetStringField(TEXT("authToken"), PendingAuthToken);
    if (!PendingRoleId.IsEmpty()) Payload->SetStringField(TEXT("requestedRoleId"), PendingRoleId);
    if (!PendingRoomId.IsEmpty()) Payload->SetStringField(TEXT("roomId"), PendingRoomId);
    SendEnvelope(TEXT("join"), Payload);
}

