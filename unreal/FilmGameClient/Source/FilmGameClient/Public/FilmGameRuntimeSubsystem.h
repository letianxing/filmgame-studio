#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "FilmGameRuntimeTypes.h"
#include "FilmGameRuntimeSubsystem.generated.h"

class IWebSocket;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FFilmGameConnectionChanged, bool, bConnected, const FString&, Message);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FFilmGameSnapshotReceived, FFilmGameRuntimeSnapshot, Snapshot);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FFilmGamePrivateStateReceived, FFilmGamePrivateState, PrivateState);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FFilmGameRuntimeError, const FString&, Code, const FString&, Message);

UCLASS()
class FILMGAMECLIENT_API UFilmGameRuntimeSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()

public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;

    UFUNCTION(BlueprintCallable, Category="FilmGame|Runtime")
    bool LoadRuntimePackage(const FString& PackagePath);

    UFUNCTION(BlueprintCallable, Category="FilmGame|Runtime")
    void Connect(const FString& AuthToken, const FString& RequestedRoleId, const FString& RoomId = TEXT(""));

    UFUNCTION(BlueprintCallable, Category="FilmGame|Runtime")
    void Disconnect();

    UFUNCTION(BlueprintCallable, Category="FilmGame|Runtime")
    void SetReady(bool bReady);

    UFUNCTION(BlueprintCallable, Category="FilmGame|Runtime")
    void FillOpenSeatsWithBots();

    UFUNCTION(BlueprintCallable, Category="FilmGame|Runtime")
    void SubmitAction(const FString& ActionId, const FString& TargetId = TEXT(""), const FString& Text = TEXT(""));

    UFUNCTION(BlueprintPure, Category="FilmGame|Runtime")
    bool IsConnected() const;

    UFUNCTION(BlueprintPure, Category="FilmGame|Runtime")
    const FFilmGameRuntimeSnapshot& GetSnapshot() const { return Snapshot; }

    UFUNCTION(BlueprintPure, Category="FilmGame|Runtime")
    const FFilmGamePrivateState& GetPrivateState() const { return PrivateState; }

    UPROPERTY(BlueprintAssignable, Category="FilmGame|Runtime")
    FFilmGameConnectionChanged OnConnectionChanged;

    UPROPERTY(BlueprintAssignable, Category="FilmGame|Runtime")
    FFilmGameSnapshotReceived OnSnapshotReceived;

    UPROPERTY(BlueprintAssignable, Category="FilmGame|Runtime")
    FFilmGamePrivateStateReceived OnPrivateStateReceived;

    UPROPERTY(BlueprintAssignable, Category="FilmGame|Runtime")
    FFilmGameRuntimeError OnRuntimeError;

private:
    void HandleConnected();
    void HandleConnectionError(const FString& Error);
    void HandleClosed(int32 StatusCode, const FString& Reason, bool bWasClean);
    void HandleMessage(const FString& Message);
    void SendEnvelope(const FString& Type, const TSharedRef<FJsonObject>& Payload);
    void SendJoin();

    TSharedPtr<IWebSocket> Socket;
    FFilmGameRuntimePackageHeader RuntimePackage;
    FFilmGameRuntimeSnapshot Snapshot;
    FFilmGamePrivateState PrivateState;
    FString PendingAuthToken;
    FString PendingRoleId;
    FString PendingRoomId;
};

