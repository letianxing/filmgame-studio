#pragma once

#include "CoreMinimal.h"
#include "FilmGameRuntimeTypes.generated.h"

USTRUCT(BlueprintType)
struct FFilmGameRuntimeAction
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    FString Id;

    UPROPERTY(BlueprintReadOnly)
    FString Label;

    UPROPERTY(BlueprintReadOnly)
    FString IntentType;

    UPROPERTY(BlueprintReadOnly)
    FString InputMode;
};

USTRUCT(BlueprintType)
struct FFilmGamePrivateState
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    FString RoleId;

    UPROPERTY(BlueprintReadOnly)
    FString Identity;

    UPROPERTY(BlueprintReadOnly)
    TArray<FString> EvidenceIds;

    UPROPERTY(BlueprintReadOnly)
    TArray<FString> InventoryIds;

    UPROPERTY(BlueprintReadOnly)
    TArray<FString> PrivateInformation;

    UPROPERTY(BlueprintReadOnly)
    TArray<FFilmGameRuntimeAction> AvailableActions;
};

USTRUCT(BlueprintType)
struct FFilmGameRuntimeSnapshot
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    FString ProjectId;

    UPROPERTY(BlueprintReadOnly)
    int32 RuntimeVersion = 0;

    UPROPERTY(BlueprintReadOnly)
    FString Phase;

    UPROPERTY(BlueprintReadOnly)
    FString SceneId;

    UPROPERTY(BlueprintReadOnly)
    int32 Sequence = 0;

    UPROPERTY(BlueprintReadOnly)
    FString TimerEndsAt;

    UPROPERTY(BlueprintReadOnly)
    FString EndingId;
};

USTRUCT(BlueprintType)
struct FFilmGameRuntimePackageHeader
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    FString SchemaVersion;

    UPROPERTY(BlueprintReadOnly)
    FString ProjectId;

    UPROPERTY(BlueprintReadOnly)
    int32 StoryVersion = 0;

    UPROPERTY(BlueprintReadOnly)
    int32 RuntimeVersion = 0;

    UPROPERTY(BlueprintReadOnly)
    FString InitialSceneId;

    UPROPERTY(BlueprintReadOnly)
    FString AssetManifestUri;
};

