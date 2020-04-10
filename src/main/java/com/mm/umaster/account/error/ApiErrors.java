package com.mm.umaster.account.error;

import org.springframework.validation.Errors;
import org.springframework.validation.FieldError;

import java.util.stream.Collectors;

public class ApiErrors extends RuntimeException  {
    public ApiErrors(String error) {
        super(error);
    }
    public static ApiErrors buildErrors(Errors errors) {
        String validationErrors = errors.getAllErrors().stream().map(e -> {
            if (e instanceof FieldError) {
                return "{\"field\":\"" + ((FieldError) e).getField() + "\",\"message\":\"" + e.getDefaultMessage() + "\"}";
            } else {
                return "{\"object\":\"" + e.getObjectName() + "\",\"message\":\"" + e.getDefaultMessage() + "\"}";
            }
        }).collect(Collectors.joining(","));
        return new ApiErrors("[" + validationErrors + "]");
    }
}
